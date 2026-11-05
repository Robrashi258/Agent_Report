import { getDb } from '../db/database'
import type { CompletionEvent, CompletionDetail, FeedbackInput, FollowupMessage, ProfileState } from '@shared/profile'

export const EVENT_LIFETIME = 24 * 3600000
export function currentEvent(id: string): CompletionEvent | null {
  if (typeof id !== 'string' || id.length > 100) throw new Error('完成记录编号无效。')
  const row = getDb().prepare(`SELECT e.id,e.task_id AS taskId,e.cycle,e.title,e.group_key AS groupKey,e.estimate_source AS estimateSource,
    e.base_min AS baseMin,e.planned_min AS plannedMin,e.had_plan AS hadPlan,e.created_at AS createdAt,
    (e.valid=1 AND t.status='done' AND t.completion_seq=e.cycle) AS valid FROM completion_events e JOIN tasks t ON t.id=e.task_id WHERE e.id=?`).get(id) as CompletionEvent | undefined
  return row ? { ...row, valid: !!row.valid, hadPlan: !!row.hadPlan } : null
}
export function feedbackForEvent(id: string): FeedbackInput | null {
  const row = getDb().prepare(`SELECT event_id AS eventId,actual_min AS actualMin,difficulty,interrupted,scope_changed AS scopeChanged,note
    FROM completion_feedback WHERE event_id=?`).get(id) as FeedbackInput | undefined
  return row ? { ...row, interrupted: !!row.interrupted, scopeChanged: !!row.scopeChanged } : null
}
export function completionForTask(taskId: number): CompletionDetail | null {
  if (!Number.isSafeInteger(taskId) || taskId < 1) throw new Error('任务编号无效。')
  const row = getDb().prepare('SELECT id FROM completion_events WHERE task_id=? ORDER BY cycle DESC LIMIT 1').get(taskId) as { id: string } | undefined
  const event = row ? currentEvent(row.id) : null
  return event ? { event, feedback: feedbackForEvent(event.id) } : null
}
export function submitFeedback(input: FeedbackInput, messageId?: string): void {
  if (!input || typeof input.eventId !== 'string' ||
    (input.actualMin !== null && (typeof input.actualMin !== 'number' || !Number.isInteger(input.actualMin) || input.actualMin < 1 || input.actualMin > 1440)) ||
    !['unknown', 'easy', 'fit', 'hard'].includes(input.difficulty) || typeof input.interrupted !== 'boolean' || typeof input.scopeChanged !== 'boolean' || typeof input.note !== 'string' || input.note.length > 800) throw new Error('反馈参数无效；实际专注耗时为1—1440分钟，也可以留空。')
  if (input.actualMin === null && input.difficulty === 'unknown' && !input.note.trim()) throw new Error('请填写至少一项反馈，或选择忽略。')
  getDb().transaction(() => {
    const event = currentEvent(input.eventId)
    if (!event?.valid) throw new Error('任务已撤销完成或记录已失效，不能将它计入反馈。')
    if (messageId) {
      const message = getDb().prepare('SELECT event_id,state,expires_at FROM followup_messages WHERE id=?').get(messageId) as { event_id: string; state: string; expires_at: string } | undefined
      if (!message || message.event_id !== input.eventId || !['open', 'answered'].includes(message.state) || new Date(message.expires_at).getTime() <= Date.now()) throw new Error('这条追问已失效；可在任务卡中查看当前完成反馈。')
    }
    getDb().prepare(`INSERT INTO completion_feedback(event_id,actual_min,difficulty,interrupted,scope_changed,note,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(event_id) DO UPDATE SET actual_min=excluded.actual_min,difficulty=excluded.difficulty,interrupted=excluded.interrupted,scope_changed=excluded.scope_changed,note=excluded.note,updated_at=excluded.updated_at`)
      .run(input.eventId, input.actualMin, input.difficulty, input.interrupted ? 1 : 0, input.scopeChanged ? 1 : 0, input.note.trim(), new Date().toISOString())
    getDb().prepare("UPDATE followup_messages SET state='answered',is_read=1 WHERE event_id=? AND state='open'").run(input.eventId)
    // 人工先补齐反馈时，无须让在途后台请求继续发布相同问题。
    getDb().prepare("UPDATE completion_jobs SET status='silent',token=NULL WHERE event_id=? AND status IN ('pending','running','failed')").run(input.eventId)
  })()
}
export function expireMessages(now = Date.now()): void {
  const db = getDb(), iso = new Date(now).toISOString(), cutoff = new Date(now - EVENT_LIFETIME).toISOString()
  db.prepare("UPDATE followup_messages SET state='expired',is_read=1 WHERE state='open' AND expires_at<=?").run(iso)
  db.prepare(`UPDATE followup_messages SET state='cancelled',is_read=1 WHERE state='open' AND event_id IN (
    SELECT e.id FROM completion_events e JOIN tasks t ON t.id=e.task_id WHERE e.valid=0 OR t.status!='done' OR t.completion_seq!=e.cycle)`).run()
  db.prepare("UPDATE completion_jobs SET status='cancelled',token=NULL WHERE status IN ('pending','running') AND event_id IN (SELECT id FROM completion_events WHERE created_at<=? OR valid=0)").run(cutoff)
}
export function profileState(now = Date.now()): ProfileState {
  expireMessages(now)
  const config = getDb().prepare('SELECT enabled,calibration_enabled FROM profile_settings WHERE id=1').get() as { enabled: number; calibration_enabled: number }
  const rows = getDb().prepare(`SELECT id,event_id AS eventId,question,fields_json,state,is_read AS isRead,created_at AS createdAt,expires_at AS expiresAt
    FROM followup_messages ORDER BY created_at DESC,rowid DESC LIMIT 100`).all() as { id: string; eventId: string; question: string; fields_json: string; state: FollowupMessage['state']; isRead: number; createdAt: string; expiresAt: string }[]
  const messages: FollowupMessage[] = rows.flatMap(r => {
    const event = currentEvent(r.eventId)
    return event ? [{ id: r.id, eventId: r.eventId, question: r.question, fields: JSON.parse(r.fields_json), state: r.state, read: !!r.isRead,
      title: event.title, createdAt: r.createdAt, expiresAt: r.expiresAt, event }] : []
  })
  const unread = (getDb().prepare("SELECT COUNT(*) AS n FROM followup_messages WHERE state='open' AND is_read=0").get() as { n: number }).n
  const pendingJobs = (getDb().prepare("SELECT COUNT(*) AS n FROM completion_jobs WHERE status IN ('pending','running')").get() as { n: number }).n
  const failedJobs = (getDb().prepare("SELECT COUNT(*) AS n FROM completion_jobs WHERE status='failed'").get() as { n: number }).n
  return { messages, unread, enabled: !!config.enabled, calibrationEnabled: !!config.calibration_enabled, pendingJobs, failedJobs }
}
export function markRead(id: string): void {
  if (typeof id !== 'string' || id.length > 100) throw new Error('消息编号无效。')
  getDb().prepare("UPDATE followup_messages SET is_read=1 WHERE id=? AND state='open'").run(id)
}
export function dismiss(id: string): void {
  if (typeof id !== 'string' || id.length > 100) throw new Error('消息编号无效。')
  getDb().prepare("UPDATE followup_messages SET state='dismissed',is_read=1 WHERE id=? AND state='open'").run(id)
}
export function setEnabled(enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new Error('设置无效。')
  getDb().transaction(() => {
    getDb().prepare('UPDATE profile_settings SET enabled=? WHERE id=1').run(enabled ? 1 : 0)
    if (!enabled) {
      getDb().prepare("UPDATE completion_jobs SET status='cancelled',token=NULL WHERE status IN ('pending','running','failed')").run()
      getDb().prepare("UPDATE followup_messages SET state='dismissed',is_read=1 WHERE state='open'").run()
    }
  })()
}
export function setCalibration(enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new Error('设置无效。')
  getDb().prepare('UPDATE profile_settings SET calibration_enabled=? WHERE id=1').run(enabled ? 1 : 0)
}
export function retryFailed(): void {
  getDb().prepare("UPDATE completion_jobs SET status='pending',attempts=0,retry_at=0,lease_until=0,token=NULL WHERE status='failed'").run()
}

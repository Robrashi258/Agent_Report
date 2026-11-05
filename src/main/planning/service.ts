import { createHash, randomUUID } from 'node:crypto'
import { getDb } from '../db/database'
import * as tasks from '../db/taskDao'
import { computeScore } from '@shared/priority'
import type { Course, CourseInput, PlanningSettings, PlanningSnapshot, PlanBlock, PlanPreview, Occupancy } from '@shared/planning'
import { at, day, dateKey, daysBetween, freeIntervals, courseOccupancy, trial, overlaps } from './engine'
import { durationEstimate, calibrationVersion } from '../memory/service'

function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error('数字参数超出允许范围。')
  return v
}
function event(action: string, data: unknown): void {
  getDb().prepare('INSERT INTO planning_events(action,data_json,created_at) VALUES(?,?,?)').run(action, JSON.stringify(data), new Date().toISOString())
}
export function settings(): PlanningSettings {
  return getDb().prepare('SELECT start_min AS startMin,end_min AS endMin,daily_max_min AS dailyMaxMin,break_min AS breakMin FROM planning_settings WHERE id=1').get() as PlanningSettings
}
export function listCourses(): Course[] {
  return getDb().prepare('SELECT id,name,weekday,start_min AS startMin,end_min AS endMin,from_date AS fromDate,to_date AS toDate FROM calendar_courses ORDER BY weekday,start_min,id').all() as Course[]
}
export function listBlocks(): PlanBlock[] {
  return getDb().prepare(`SELECT p.id,p.task_id AS taskId,COALESCE(t.summary,t.content) AS title,p.start_at AS start,p.end_at AS end,p.locked,p.reason
    FROM plan_blocks p JOIN tasks t ON t.id=p.task_id WHERE t.status != 'archived' ORDER BY p.start_at`).all().map(r => ({ ...(r as PlanBlock), locked: !!(r as PlanBlock).locked }))
}
export function snapshot(startDate: string, endDate: string): PlanningSnapshot {
  const dates = daysBetween(startDate, endDate), courses = listCourses(), blocks = listBlocks(), config = settings()
  const taskData = tasks.listTasks().map(t => [t.id, t.status, t.updatedAt, t.estimateMin, t.baseEstimateMin, t.estimateGroup, t.estimateSource, t.deadlineAt, t.deadlineConfirmed, t.rangeStart, t.rangeEnd])
  const version = createHash('sha256').update(JSON.stringify([taskData, courses, blocks, config, calibrationVersion(), Intl.DateTimeFormat().resolvedOptions().timeZone])).digest('hex')
  const start = at(startDate, 0), end = at(endDate, 1440)
  const occupied: Occupancy[] = [...courseOccupancy(courses, dates), ...blocks.filter(b => b.start < end && start < b.end).map(b => ({ ...b, kind: 'task' as const }))]
  return { startDate, endDate, version, settings: config, courses, blocks: blocks.filter(b => b.start < end && start < b.end), occupied }
}
export function saveSettings(input: PlanningSettings): void {
  const start = integer(input.startMin, 0, 1439), end = integer(input.endMin, 1, 1440), daily = integer(input.dailyMaxMin, 15, 1440), pause = integer(input.breakMin, 0, 120)
  if (start >= end || daily > end - start) throw new Error('可安排窗口和每日上限不合理。')
  getDb().transaction(() => {
    // 已存计划不因设置变化被静默移走；设置缩小时要求先处理窗口外安排。
    for (const b of listBlocks().filter(b => b.end > Date.now())) {
      const date = dateKey(b.start)
      if (b.start < at(date, start) || b.end > at(date, end)) throw new Error('已有执行安排在新窗口之外，请先移除或调整这些安排。')
      const sameDay = listBlocks().filter(p => dateKey(p.start) === date).reduce((sum, p) => sum + (p.end - p.start) / 60000, 0)
      if (sameDay > daily) throw new Error('现有安排超过新的每日上限，请先调整安排。')
    }
    const arranged = listBlocks().filter(b => b.end > Date.now()).sort((a, b) => a.start - b.start)
    for (let i = 1; i < arranged.length; i++) {
      if (dateKey(arranged[i - 1].start) === dateKey(arranged[i].start) && arranged[i].start < arranged[i - 1].end + pause * 60000) throw new Error('新的休息间隔与已有任务冲突，请先调整这些安排。')
    }
    getDb().prepare('UPDATE planning_settings SET start_min=?,end_min=?,daily_max_min=?,break_min=? WHERE id=1').run(start, end, daily, pause)
    event('settings', input)
  })()
}
export function saveCourse(input: CourseInput): void {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw new Error('请输入1—80字课程/固定事件名。')
  integer(input.weekday, 1, 7); integer(input.startMin, 0, 1439); integer(input.endMin, 1, 1440)
  day(input.fromDate); day(input.toDate)
  if (input.startMin >= input.endMin || input.fromDate > input.toDate || new Date(input.toDate).getTime() - new Date(input.fromDate).getTime() > 370 * 86400000) throw new Error('课程时间或生效范围无效（最长一年）。')
  getDb().transaction(() => {
    const course: Course = { ...input, id: -1 }
    for (const b of listBlocks().filter(b => b.end > Date.now())) {
      const date = dateKey(b.start)
      if (courseOccupancy([course], [date]).some(c => overlaps(c, b))) throw new Error('课程与已有执行安排冲突，请先处理该任务安排。')
    }
    getDb().prepare('INSERT INTO calendar_courses(name,weekday,start_min,end_min,from_date,to_date) VALUES(?,?,?,?,?,?)')
      .run(input.name.trim(), input.weekday, input.startMin, input.endMin, input.fromDate, input.toDate)
    event('course_added', input)
  })()
}
export function deleteCourse(id: number): void {
  integer(id, 1, Number.MAX_SAFE_INTEGER)
  getDb().transaction(() => { getDb().prepare('DELETE FROM calendar_courses WHERE id=?').run(id); event('course_removed', { id }) })()
}
export function getFree(startDate: string, endDate: string, now = Date.now()): object {
  const data = snapshot(startDate, endDate)
  return { ...data, days: daysBetween(startDate, endDate).map(date => ({ date,
    intervals: freeIntervals(date, data.settings, data.occupied, now),
    remainingCapacityMin: Math.max(0, data.settings.dailyMaxMin - data.blocks.filter(b => dateKey(b.start) === date).reduce((sum, b) => sum + (b.end - b.start) / 60000, 0))
  })) }
}
export function preview(taskIds: number[], startDate: string, endDate: string, runId: string | null = null, now = Date.now(), timeWindow?: { startMin?: number; endMin?: number }): PlanPreview {
  if (!Array.isArray(taskIds) || !taskIds.length || taskIds.length > 20 || new Set(taskIds).size !== taskIds.length) throw new Error('请选择1—20个不同任务。')
  taskIds.forEach(id => integer(id, 1, Number.MAX_SAFE_INTEGER))
  const snap = snapshot(startDate, endDate), dates = daysBetween(startDate, endDate)
  const effectiveSettings = { ...snap.settings,
    startMin: Math.max(snap.settings.startMin, timeWindow?.startMin === undefined ? 0 : integer(timeWindow.startMin, 0, 1439)),
    endMin: Math.min(snap.settings.endMin, timeWindow?.endMin === undefined ? 1440 : integer(timeWindow.endMin, 1, 1440)) }
  if (effectiveSettings.startMin >= effectiveSettings.endMin) throw new Error('指定时段与可安排窗口没有交集。')
  const selected = taskIds.map(id => {
    const task = tasks.getTaskById(id)
    if (!task || task.status !== 'pending') throw new Error('所选任务不存在、未分析或已经完成。')
    return task
  })
  // 全局读取所选任务的旧块，跨窗口移动时同样受锁定/已开始限制。
  const previous = listBlocks().filter(b => taskIds.includes(b.taskId))
  const fixedIds = new Set(previous.filter(b => b.locked || b.start < now).map(b => b.taskId))
  const retainedReasons = new Map<number, string>()
  fixedIds.forEach(id => retainedReasons.set(id, '已有安排锁定或已经开始，本次不自动移动。'))
  let result: ReturnType<typeof trial> = { blocks: [], unscheduled: [] }
  // 部分重排失败时保留其旧块并重新计算，不能把未移走的旧块当作空闲。
  for (let pass = 0; pass <= selected.length; pass++) {
    const occupied = snap.occupied.filter(b => b.kind === 'course' || !taskIds.includes(b.taskId!) || fixedIds.has(b.taskId!))
    result = trial(selected.filter(t => !fixedIds.has(t.id)).map(t => ({ id: t.id, title: t.summary || t.content, duration: durationEstimate(t).estimateMin, score: computeScore(t, now),
      deadline: t.deadlineAt ? new Date(t.deadlineAt).getTime() : null, confirmed: t.deadlineConfirmed,
      earliestDate: t.rangeStart, latestDate: t.rangeEnd })), dates, effectiveSettings, occupied, now)
    const newlyRetained = result.unscheduled.filter(u => previous.some(b => b.taskId === u.taskId) && !fixedIds.has(u.taskId))
    if (!newlyRetained.length) break
    newlyRetained.forEach(u => { fixedIds.add(u.taskId); retainedReasons.set(u.taskId, `${u.reason} 原执行安排保留。`) })
  }
  retainedReasons.forEach((reason, id) => result.unscheduled.push({ taskId: id, title: selected.find(t => t.id === id)!.content, reason }))
  result.blocks.forEach(b => { const estimate = durationEstimate(selected.find(t => t.id === b.taskId)!); if (estimate.applied) b.reason += ` 个人估时${estimate.baseMin}→${estimate.estimateMin}分钟，${estimate.sampleCount}个有效样本（系数${estimate.factor.toFixed(2)}）。` })
  const data: PlanPreview = { id: randomUUID(), runId, startDate, endDate, version: snap.version, createdAt: new Date(now).toISOString(), taskIds, previous,
    timeWindow: { startMin: effectiveSettings.startMin, endMin: effectiveSettings.endMin }, ...result }
  getDb().prepare('INSERT INTO plan_previews(id,run_id,json,created_at) VALUES(?,?,?,?)').run(data.id, runId, JSON.stringify(data), data.createdAt)
  return data
}
export function loadPreview(id: string, runId: string | null): PlanPreview {
  if (typeof id !== 'string' || id.length > 100) throw new Error('试排编号无效。')
  const row = getDb().prepare('SELECT json,run_id FROM plan_previews WHERE id=?').get(id) as { json: string; run_id: string | null } | undefined
  if (!row || row.run_id !== runId) throw new Error('试排不存在或不属于当前对话。')
  return JSON.parse(row.json)
}
export function commit(id: string, runId: string | null, now = Date.now()): { saved: true; count: number; unscheduled: PlanPreview['unscheduled'] } {
  return getDb().transaction(() => {
    const p = loadPreview(id, runId)
    const existing = getDb().prepare('SELECT committed_json FROM plan_previews WHERE id=?').get(id) as { committed_json: string | null }
    if (existing.committed_json) return JSON.parse(existing.committed_json)
    if (!p.blocks.length) throw new Error('没有可保存的执行时段。')
    if (now - new Date(p.createdAt).getTime() > 30 * 60000) throw new Error('试排已过期，请重新试排。')
    if (snapshot(p.startDate, p.endDate).version !== p.version) throw new Error('任务、课表、个人估时或计划已变化，请重新试排。')
    // 课程/容量等输入快照必须保持一致，并重新检查真实当前时间和截止。
    for (const b of p.blocks) {
      const task = tasks.getTaskById(b.taskId)!
      if (b.start < now || !task.deadlineConfirmed || (task.deadlineAt && b.end > new Date(task.deadlineAt).getTime())) throw new Error('时段已开始或截止约束失效，请重新试排。')
    }
    validateBlocks(p, now)
    const stmt = getDb().prepare('INSERT INTO plan_blocks(task_id,start_at,end_at,locked,reason,created_at) VALUES(?,?,?,?,?,?)')
    for (const b of p.blocks) {
      getDb().prepare('DELETE FROM plan_blocks WHERE task_id=?').run(b.taskId)
      stmt.run(b.taskId, b.start, b.end, 0, b.reason, new Date(now).toISOString())
    }
    const result = { saved: true as const, count: p.blocks.length, unscheduled: p.unscheduled }
    getDb().prepare('UPDATE plan_previews SET committed_json=? WHERE id=?').run(JSON.stringify(result), id)
    event('plan_committed', { previewId: id, runId, previous: p.previous, blocks: p.blocks, result })
    return result
  })()
}
function validateBlocks(p: PlanPreview, now: number): void {
  const snap = snapshot(p.startDate, p.endDate), ids = p.blocks.map(b => b.taskId)
  if (new Set(ids).size !== ids.length || ids.some(id => !p.taskIds.includes(id))) throw new Error('执行块身份不一致。')
  const others = snap.occupied.filter(b => b.kind === 'course' || !ids.includes(b.taskId!))
  const all = [...others, ...p.blocks.map(b => ({ ...b, kind: 'task' as const }))]
  for (const b of p.blocks) {
    const t = tasks.getTaskById(b.taskId), date = dateKey(b.start)
    if (!t || t.status !== 'pending' || !t.deadlineConfirmed || b.start < now || b.end <= b.start || date < p.startDate || date > p.endDate ||
      b.start < at(date, Math.max(p.timeWindow.startMin, snap.settings.startMin)) || b.end > at(date, Math.min(p.timeWindow.endMin, snap.settings.endMin)) ||
      b.end - b.start < Math.ceil(durationEstimate(t).estimateMin / 15) * 15 * 60000 || (t.deadlineAt && b.end > new Date(t.deadlineAt).getTime()) ||
      (t.rangeStart && date < t.rangeStart) || (t.rangeEnd && date > t.rangeEnd)) throw new Error('执行块不满足时间约束。')
    if (others.some(o => overlaps(b, o)) || p.blocks.some(o => o !== b && overlaps(b, o))) throw new Error('执行块存在冲突。')
    const sameDay = all.filter(o => o.kind === 'task' && dateKey(o.start) === date)
    if (sameDay.reduce((sum, o) => sum + (o.end - o.start) / 60000, 0) > snap.settings.dailyMaxMin) throw new Error('执行块超过每日容量。')
    for (const o of sameDay) {
      if (o.taskId === b.taskId) continue
      const gap = o.end <= b.start ? b.start - o.end : b.end <= o.start ? o.start - b.end : -1
      if (gap < snap.settings.breakMin * 60000) throw new Error('执行块间休息不足。')
    }
  }
}
export function lockBlock(id: number, locked: boolean): void {
  integer(id, 1, Number.MAX_SAFE_INTEGER)
  if (typeof locked !== 'boolean') throw new Error('锁定参数无效。')
  getDb().transaction(() => { getDb().prepare('UPDATE plan_blocks SET locked=? WHERE id=?').run(locked ? 1 : 0, id); event('block_locked', { id, locked }) })()
}
export function removeBlock(id: number): void {
  integer(id, 1, Number.MAX_SAFE_INTEGER)
  getDb().transaction(() => { getDb().prepare('DELETE FROM plan_blocks WHERE id=?').run(id); event('block_removed', { id }) })()
}

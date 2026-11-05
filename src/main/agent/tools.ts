import * as tasks from '../db/taskDao'
import { getDb } from '../db/database'
import type { PriorityChange } from '@shared/agent'
import type { Task } from '@shared/types'
import type { ToolDefinition } from './model'
import { createHash } from 'node:crypto'

type Field = { type: 'string' | 'integer'; description?: string; enum?: string[]; minimum?: number; maximum?: number; maxLength?: number }
interface Spec { name: string; description: string; fields: Record<string, Field>; required: string[] }
const specs: Spec[] = [
  { name: 'list_tasks', description: '查询任务。按关键词和状态筛选，返回真实字段及updatedAt；不会修改数据。',
    fields: { query: { type: 'string', maxLength: 100 }, status: { type: 'string', enum: ['active', 'done', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: [] },
  { name: 'get_task', description: '按ID读取一条任务最新状态。提出调级前必须先读取；归档任务不可修改。',
    fields: { taskId: { type: 'integer', minimum: 1 } }, required: ['taskId'] },
  { name: 'propose_priority_change', description: '提出重要度/紧急度修改草案，必须使用刚读取的ID和updatedAt。不会立即写入；用户点击确认后应用。至少指定一种评分。',
    fields: { taskId: { type: 'integer', minimum: 1 }, importance: { type: 'integer', minimum: 1, maximum: 5 }, urgency: { type: 'integer', minimum: 1, maximum: 5 },
      expectedUpdatedAt: { type: 'string', maxLength: 60 }, reason: { type: 'string', maxLength: 200 } }, required: ['taskId', 'expectedUpdatedAt', 'reason'] },
  { name: 'ask_user', description: '信息不足或任务指代有歧义时向用户提出一个简短问题，保存并等待回复；信息充分时不必调用。',
    fields: { question: { type: 'string', maxLength: 500 } }, required: ['question'] },
  { name: 'finish_reply', description: '本轮信息已充分时，以简短答复结束；不可用于提出需要用户回答的问题，不可声称尚未确认的操作已执行。',
    fields: { text: { type: 'string', maxLength: 3000 } }, required: ['text'] }
]
export const toolDefinitions: ToolDefinition[] = specs.map(s => ({ type: 'function', function: {
  name: s.name, description: s.description,
  parameters: { type: 'object', properties: s.fields, required: s.required, additionalProperties: false }
} }))

export interface ToolContext { observed: Map<number, string> }
export interface ToolResult {
  ok: boolean; data?: unknown; errorCode?: string; message?: string
  pause?: 'waiting_user' | 'awaiting_confirmation' | 'completed'; pending?: PriorityChange
}
function fail(errorCode: string, message: string): ToolResult { return { ok: false, errorCode, message } }
function view(t: Task): object {
  return { id: t.id, content: t.content.slice(0, 400), summary: t.summary, status: t.status, importance: t.importance,
    urgency: t.urgency, dueAt: t.dueAt, estimateMin: t.estimateMin, manualLocked: t.manualLocked, updatedAt: t.updatedAt }
}
export function executeTool(name: string, raw: string, context: ToolContext): ToolResult {
  const spec = specs.find(s => s.name === name)
  if (!spec) return fail('UNKNOWN_TOOL', '工具不存在；只能使用已注册的工具。')
  let args: Record<string, unknown>
  try { args = JSON.parse(raw) } catch { return fail('INVALID_ARGUMENTS', '参数不是有效JSON。') }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return fail('INVALID_ARGUMENTS', '参数必须是对象。')
  if (Object.keys(args).some(k => !Object.hasOwn(spec.fields, k)) || spec.required.some(k => !Object.hasOwn(args, k))) return fail('INVALID_ARGUMENTS', '参数缺失或包含不允许的字段。')
  for (const [key, value] of Object.entries(args)) {
    const field = spec.fields[key]
    if (field.type === 'string' && (typeof value !== 'string' || value.length > (field.maxLength ?? 500) || (field.enum && !field.enum.includes(value)))) return fail('INVALID_ARGUMENTS', `${key}不是允许的字符串。`)
    if (field.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (field.minimum ?? 0) || value > (field.maximum ?? Number.MAX_SAFE_INTEGER))) return fail('INVALID_ARGUMENTS', `${key}不是范围内整数。`)
    if (spec.required.includes(key) && typeof value === 'string' && !value.trim()) return fail('INVALID_ARGUMENTS', `${key}不能为空。`)
  }
  if (name === 'list_tasks') {
    const list = tasks.listTasks(args.status === 'all' ? {} : { status: args.status === 'done' ? 'done' : 'active' })
      .filter(t => !args.query || `${t.content} ${t.summary ?? ''}`.toLocaleLowerCase().includes(String(args.query).toLocaleLowerCase()))
    const selected = list.slice(0, Number(args.limit ?? 10))
    selected.forEach(t => context.observed.set(t.id, t.updatedAt))
    return { ok: true, data: { tasks: selected.map(view), totalMatches: list.length, truncated: selected.length < list.length } }
  }
  if (name === 'ask_user') return { ok: true, data: { question: args.question }, pause: 'waiting_user' }
  if (name === 'finish_reply') return { ok: true, data: { text: args.text }, pause: 'completed' }
  const task = tasks.getTaskById(Number(args.taskId))
  if (!task || task.status === 'archived') return fail('NOT_FOUND', '该任务不存在或已归档。')
  if (name === 'get_task') { context.observed.set(task.id, task.updatedAt); return { ok: true, data: view(task) } }
  if (task.status !== 'pending') return fail('INVALID_STATE', '只可调整已分析、未完成的任务。')
  if (context.observed.get(task.id) !== task.updatedAt) return fail('READ_REQUIRED', '请先读取本次运行中的最新任务数据。')
  if (args.expectedUpdatedAt !== task.updatedAt) return fail('VERSION_CONFLICT', '任务已变化，请重新读取。')
  if (args.importance === undefined && args.urgency === undefined) return fail('INVALID_ARGUMENTS', '至少指定重要度或紧急度。')
  const after = { importance: Number(args.importance ?? task.importance), urgency: Number(args.urgency ?? task.urgency) }
  if (after.importance === task.importance && after.urgency === task.urgency) return { ok: true, data: { unchanged: true }, message: '评分未变化，无需修改。' }
  const pending: PriorityChange = { taskId: task.id, title: task.summary || task.content, expectedUpdatedAt: task.updatedAt,
    before: { importance: task.importance, urgency: task.urgency }, after, reason: String(args.reason) }
  return { ok: true, data: { proposed: pending, saved: false }, pause: 'awaiting_confirmation', pending }
}

// 仅由可信UI确认路径调用，不注册给模型。
export function applyPriorityChange(runId: string, pending: PriorityChange): object {
  return getDb().transaction(() => {
    const actionKey = createHash('sha256').update(JSON.stringify(pending)).digest('hex')
    const previous = getDb().prepare('SELECT result_json FROM agent_actions WHERE run_id=? AND action_key=?').get(runId, actionKey) as { result_json: string } | undefined
    if (previous) return JSON.parse(previous.result_json)
    const current = tasks.getTaskById(pending.taskId)
    if (!current || current.status !== 'pending' || current.updatedAt !== pending.expectedUpdatedAt ||
      current.importance !== pending.before.importance || current.urgency !== pending.before.urgency) throw new Error('任务已变化，本草案已失效。请重新查询后再调整。')
    const changed = tasks.updateTask({ id: current.id, ...pending.after })!
    const result = { taskId: current.id, before: pending.before, after: pending.after, updatedAt: changed.updatedAt, saved: true }
    getDb().prepare('INSERT INTO agent_actions(run_id,action_key,result_json,created_at) VALUES(?,?,?,?)')
      .run(runId, actionKey, JSON.stringify(result), new Date().toISOString())
    return result
  })()
}

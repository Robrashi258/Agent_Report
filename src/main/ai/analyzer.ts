// ===== AI 分析编排：串行队列 + JSON 容错解析 + 降级 + 每日重评 =====

import type { AiAnalysisResult, AiStatus, Task } from '@shared/types'
import { getSettings } from '../db/settingsDao'
import * as taskDao from '../db/taskDao'
import { getDb } from '../db/database'
import { chatCompletion, isAiConfigured, AiClientError } from './client'
import { buildAnalyzeMessages, buildReviewMessages } from './prompt'
import { ruleAnalyze } from './rules'

type BroadcastFn = () => void
let broadcast: BroadcastFn = (): void => {}

/** 注入广播函数（ipc.ts 注册时调用） */
export function setBroadcastFn(fn: BroadcastFn): void {
  broadcast = fn
}

// ===== 串行队列 =====
const queue: number[] = []
let processing = false

export function enqueueAnalyze(taskId: number): void {
  if (!queue.includes(taskId)) queue.push(taskId)
  void processQueue()
}

async function processQueue(): Promise<void> {
  if (processing) return
  processing = true
  while (queue.length > 0) {
    const id = queue.shift()!
    try {
      await analyzeOne(id)
    } catch (e) {
      console.error(`[analyzer] task ${id} 分析异常`, e)
    }
    await sleep(400) // 任务间隔，防限流
  }
  processing = false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ===== 单任务分析 =====
async function analyzeOne(id: number): Promise<void> {
  const task = taskDao.getTaskById(id)
  if (!task || task.status !== 'inbox') return

  const settings = getSettings()
  if (!isAiConfigured(settings)) {
    // 未配置 AI：规则兜底，直接进排序池
    applyResult(id, ruleAnalyze(task.content), 'none')
    return
  }

  try {
    const raw = await chatCompletion(settings, buildAnalyzeMessages(task.content), {
      jsonMode: true,
      temperature: 0.2
    })
    const result = parseAiJson(raw, task.content)
    applyResult(id, result, 'ok')
  } catch (e) {
    if (e instanceof AiClientError) {
      console.warn(`[analyzer] task ${id} AI 失败: ${e.message}，走规则兜底`)
    } else {
      console.warn(`[analyzer] task ${id} 异常`, e)
    }
    applyResult(id, ruleAnalyze(task.content), 'failed')
  }
}

/** 重试分析（用户点击重试按钮；AI 失败的 pending 任务也允许） */
export function retryAnalyze(id: number): void {
  const task = taskDao.getTaskById(id)
  if (!task) return
  taskDao.markAiStatus(id, 'pending')
  if (task.status === 'pending') {
    // 从排序池拉回收件箱重新走完整分析
    taskDao.moveBackToInbox(id)
  }
  broadcast()
  enqueueAnalyze(id)
}

// ===== 结果落库 =====
function applyResult(id: number, result: AiAnalysisResult, aiStatus: AiStatus): void {
  taskDao.applyAnalysis(id, result, aiStatus)
  broadcast()
}

// ===== JSON 容错解析 =====
export function parseAiJson(raw: string, fallbackContent: string): AiAnalysisResult {
  let text = raw.trim()
  // 剥 ```json ... ``` 代码块包裹
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()

  let obj: Record<string, unknown> | null = null
  try {
    obj = JSON.parse(text)
  } catch {
    // 提取首个 {...} 块
    const brace = text.match(/\{[\s\S]*\}/)
    if (brace) {
      try {
        obj = JSON.parse(brace[0])
      } catch {
        obj = null
      }
    }
  }
  if (!obj || typeof obj !== 'object') {
    throw new AiClientError('AI 返回的不是有效 JSON')
  }

  // 字段逐个校验，非法回退
  const rule = ruleAnalyze(fallbackContent)
  const categories = ['工作', '生活', '学习', '其他']

  const importance = clampInt(obj.importance, 1, 5, rule.importance)
  const urgency = clampInt(obj.urgency, 1, 5, rule.urgency)
  const category = categories.includes(obj.category as string) ? (obj.category as AiAnalysisResult['category']) : rule.category
  const estimateRaw = Number(obj.estimate_min)
  const estimateMin = [15, 30, 60, 120, 240].includes(estimateRaw) ? estimateRaw : rule.estimateMin

  // summary：AI 给的一句话提炼；非法/缺失时回退本地截断
  let summary: string | null = rule.summary
  if (typeof obj.summary === 'string' && obj.summary.trim()) {
    summary = obj.summary.trim().slice(0, 50)
  } else if (obj.summary === null) {
    summary = rule.summary
  }

  let tags: string[] = rule.tags
  if (Array.isArray(obj.tags)) {
    tags = obj.tags
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 10))
      .slice(0, 3)
  }

  let dueAt: string | null = rule.dueAt
  if (typeof obj.due_at === 'string' && obj.due_at.trim()) {
    const parsed = normalizeDue(obj.due_at.trim())
    if (parsed) dueAt = parsed
  } else if (obj.due_at === null) {
    dueAt = null
  }

  return { summary, importance, urgency, category, tags, estimateMin, dueAt }
}

/** 校验 AI 给的 due_at：合法日期、在 [今天-1天, 今天+2年] 范围内 → 本地 ISO；否则 null */
function normalizeDue(raw: string): string | null {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const now = Date.now()
  if (d.getTime() < now - 24 * 3600_000) return null // 早于昨天 → 不可信
  if (d.getTime() > now + 2 * 365 * 24 * 3600_000) return null // 超过两年 → 不可信
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

// ===== 每日重评 =====
const LAST_REVIEW_KEY = 'last_daily_review'
const REVIEW_LIMIT = 100

/** 每天首次启动调用：AI 已配置且有 pending 任务 → 全部重评 imp/urg */
export async function dailyReview(): Promise<void> {
  const settings = getSettings()
  if (!isAiConfigured(settings)) return

  const today = new Date().toDateString()
  const last = getInternalSetting(LAST_REVIEW_KEY)
  if (last === today) return

  const pending = taskDao.listTasks({ status: 'pending' })
  if (pending.length === 0) {
    setInternalSetting(LAST_REVIEW_KEY, today)
    return
  }

  // 手动锁定的任务跳过（用户调过的重要性/紧急度是明确信号，AI 不覆盖）
  const targets = pending.filter((t) => !t.manualLocked).slice(0, REVIEW_LIMIT)
  if (targets.length === 0) {
    setInternalSetting(LAST_REVIEW_KEY, today)
    return
  }
  console.log(`[analyzer] 每日重评开始：${targets.length} 个任务（跳过 ${pending.length - targets.length} 个手动锁定）`)

  for (const task of targets) {
    try {
      const raw = await chatCompletion(settings, buildReviewMessages(task.content, {
        importance: task.importance,
        urgency: task.urgency,
        dueAt: task.dueAt
      }), { jsonMode: true, temperature: 0.2 })
      const parsed = parseReviewJson(raw)
      if (parsed) {
        taskDao.updateTask({ id: task.id, importance: parsed.importance, urgency: parsed.urgency })
      }
    } catch (e) {
      console.warn(`[analyzer] 重评 task ${task.id} 失败`, e)
      // 单个失败不中断整体，但今天不再整体重试（下次启动再来）
    }
    await sleep(400)
  }

  setInternalSetting(LAST_REVIEW_KEY, today)
  broadcast()
  console.log('[analyzer] 每日重评完成')
}

function parseReviewJson(raw: string): { importance: number; urgency: number } | null {
  try {
    const obj = JSON.parse(raw.trim().replace(/^```(?:json)?|```$/g, ''))
    const importance = clampInt(obj.importance, 1, 5, 3)
    const urgency = clampInt(obj.urgency, 1, 5, 3)
    return { importance, urgency }
  } catch {
    return null
  }
}

// ===== 内部设置键（不进 UI 表单，直接读写 settings 表） =====
function getInternalSetting(key: string): string | null {
  return getRawSetting(key)
}

function setInternalSetting(key: string, value: string): void {
  setRawSetting(key, value)
}

// 裸键读写（避免污染 AppSettings 结构）
function getRawSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined
  return row ? JSON.parse(row.value) : null
}
function setRawSetting(key: string, value: string): void {
  getDb()
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, JSON.stringify(value))
}

/** 启动钩子：恢复中断的分析 + 触发每日重评 */
export function onAppStart(): void {
  const inbox = taskDao.listTasks({ status: 'inbox' })
  for (const t of inbox) {
    enqueueAnalyze(t.id)
  }
  void dailyReview()
}

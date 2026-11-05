// ===== 优先级计算纯函数（主进程/桌面端/手机端共用）=====
// v2 设计（2026-10-21 重排）：重要×紧急是底子，截止临近是乘数放大器。
// 动机：v1 中截止是平行加分项，导致"重要性5无截止"压过"重要性3但6小时后截止"，违反直觉。

import type { Task } from './types'

/** 基础权重：重要性 0.40 + 紧急度 0.30 + 拖延 0.30（底子，无截止时分数即底子×100） */
export const BASE_WEIGHTS = {
  importance: 0.4,
  urgency: 0.3,
  procrastination: 0.3
}

/**
 * 截止乘数：越近放大越狠（乘在底子上）
 * 已过期 3.0 | ≤6h 2.2 | ≤24h 1.9 | ≤48h 1.4 | ≤96h 1.2 | ≤7天 1.1 | ≤30天 0.95 | 更远 0.85 | 无截止 1.0
 * 注：同级过期稳压近期；低重要过期不越级压高重要近期（过期区另有红色置顶展示）
 */
export function deadlineFactor(dueAt: string | null, now = Date.now()): number {
  if (!dueAt) return 1.0
  const h = (new Date(dueAt).getTime() - now) / 3_600_000
  if (h <= 0) return 3.0
  if (h <= 6) return 2.2
  if (h <= 24) return 1.9
  if (h <= 48) return 1.4
  if (h <= 96) return 1.2
  if (h <= 168) return 1.1
  if (h <= 720) return 0.95
  return 0.85
}

/** 拖延加成 [0,1]：每推迟一次 +0.2，封顶 1 */
export function procrastinationBoost(snoozeCount: number): number {
  return Math.min(1, snoozeCount / 5)
}

/**
 * 综合优先级分数（越高越先做）。
 * score = 100 × (0.40×重要性/5 + 0.30×紧急度/5 + 0.30×拖延) × 截止乘数
 * 直觉：重要紧急决定"该不该做"，截止临近决定"现在做不做"——临近截止把中等任务顶到最前。
 */
export function computeScore(
  task: Pick<Task, 'importance' | 'urgency' | 'dueAt' | 'snoozeCount'>,
  now = Date.now()
): number {
  const w = BASE_WEIGHTS
  const base =
    w.importance * clamp01(task.importance / 5) +
    w.urgency * clamp01(task.urgency / 5) +
    w.procrastination * procrastinationBoost(task.snoozeCount)
  return Math.round(100 * base * deadlineFactor(task.dueAt, now))
}

/** 是否已过期 */
export function isOverdue(task: Pick<Task, 'dueAt'>, now = Date.now()): boolean {
  if (!task.dueAt) return false
  return new Date(dueAt).getTime() < now
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

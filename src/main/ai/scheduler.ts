// ===== 范围计划调度器 =====
// "第 1 周（10/19–10/25）打地基"类范围计划：任务只有范围没有具体天。
// 目标：① 按链序把任务均衡分配到范围内各天（考虑每天已有负载，避免全堆最后一天）
//       ② 紧急链（urgency≥4 或 importance≥4）前压占最早的未满日
//       ③ 新任务当天超载时，比它弱的已有任务自动后移一天（链条任务则下游锚定顺延）

import type { Task } from '@shared/types'
import * as taskDao from '../db/taskDao'
import { addDays } from './rules'

/** 单日软上限（分钟）：超过此线 → 触发已有任务后排 */
const SOFT_CAP_MIN = 240

export interface RebalanceResult {
  assigned: number // 分到具体日期的任务数
  displaced: number // 被挤占后移的已有任务数
}

/** 任务强弱序：重要性为主、紧急度为辅（用于"谁给谁让位"：只挪比新任务弱的） */
function rank(t: Task): number {
  return t.importance * 10 + t.urgency
}

/** 重排所有未落地的范围任务（批量导入后自动调用）。
 *  兜底：链条整组无日期且无 range（AI 两头都没给）→ 按"今天起至组内最晚已有日期，否则今天+6 天"补一个范围再分配 */
export function rebalanceUnscheduled(): RebalanceResult {
  const tasks = taskDao.listUnscheduledRangeTasks()

  // 兜底分组：无 range 但同组全无日期的链条
  const orphans = tasks.filter((t) => !t.rangeStart || !t.rangeEnd)
  if (orphans.length > 0) {
    const today = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
    const byProject = new Map<string, Task[]>()
    for (const t of orphans) {
      if (!t.projectId) continue
      const list = byProject.get(t.projectId) ?? []
      list.push(t)
      byProject.set(t.projectId, list)
    }
    for (const [projectId, list] of byProject) {
      // 组内若已有环节带日期 → 用 [今天, 最晚日期]；否则默认今天起 7 天
      const dues = taskDao
        .listActiveChainTasks(projectId)
        .filter((t) => t.dueAt)
        .map((t) => t.dueAt!.slice(0, 10))
        .sort()
      const end = dues.length ? dues.at(-1)! : addDays(todayStr, 6)
      for (const t of list) {
        taskDao.setRange(t.id, todayStr, end < todayStr ? todayStr : end)
      }
    }
  }

  return assignTasks(taskDao.listUnscheduledRangeTasks())
}

/** 重排单个项目链（项目视图"重新分配"按钮）：先清空该链范围任务的 due 再重排 */
export function rebalanceProject(projectId: string): RebalanceResult {
  const tasks = taskDao.listActiveChainTasks(projectId).filter((t) => t.rangeStart && t.rangeEnd)
  for (const t of tasks) {
    taskDao.setScheduledDue(t.id, null)
  }
  return assignTasks(tasks)
}

/** 核心：按 (rangeStart, rangeEnd) 分组分配（多周计划各用各的范围）；组内按 chain_order（链序即先后） */
function assignTasks(tasks: Task[]): RebalanceResult {
  let assigned = 0
  let displaced = 0

  const groups = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!t.rangeStart || !t.rangeEnd) continue
    const key = `${t.rangeStart}~${t.rangeEnd}`
    const list = groups.get(key) ?? []
    list.push(t)
    groups.set(key, list)
  }

  for (const [key, list] of groups) {
    const [rs, re] = key.split('~')
    const days = enumDays(rs, re)
    if (days.length === 0) continue

    // 范围内每天已有负载（分钟；其他项目先前已落地的分配也会计入）
    const loads = taskDao.dayLoadsBetween(`${rs}T00:00:00`, `${re}T23:59:59`)

    // 链条环节天然有先后：逐环节推进日期（环节1→范围内第 1 个可用天，环节2→下一天…）
    // 某天已超软上限 → 跳到下一天；cursor 起全超载 → 从 cursor 起找最轻天（保持链序推进，触发挤占）
    let cursor = 0
    for (const t of list) {
      let idx = cursor
      while (idx < days.length && (loads.get(days[idx]) ?? 0) >= SOFT_CAP_MIN) idx++
      if (idx >= days.length) {
        // 从 cursor 起全超载 → cursor 起找最轻天（不回卷到范围开头，保持链条先后）
        let lightest = cursor
        for (let i = cursor + 1; i < days.length; i++) {
          if ((loads.get(days[i]) ?? 0) < (loads.get(days[lightest]) ?? 0)) lightest = i
        }
        idx = lightest
      }
      const day = days[idx]
      taskDao.setScheduledDue(t.id, `${day}T23:59:00`)
      loads.set(day, (loads.get(day) ?? 0) + t.estimateMin)
      assigned++
      displaced += relieveOverflow(day, loads, t)
      // 下一环节至少下一天；超出范围则回卷（round-robin 继续均衡）
      cursor = idx + 1 < days.length ? idx + 1 : 0
    }
  }
  return { assigned, displaced }
}

/** 枚举范围内各天（YYYY-MM-DD 升序）；早于今天的截到今天；范围全在过去 → 只留今天 */
function enumDays(startDay: string, endDay: string): string[] {
  const today = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  const from = startDay > todayStr ? startDay : todayStr
  const to = endDay < from ? from : endDay
  const days: string[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard++ < 120) {
    days.push(cur)
    cur = addDays(cur, 1)
  }
  return days
}

/** 当天超载 → 把比 newcomer 弱的已有任务后移一天（保留原时刻；链条任务自动顺延下游），
 *  直到回到软上限内或没有可挪的（比新任务强的/手动锁定的不动）。返回挪动数。 */
function relieveOverflow(day: string, loads: Map<string, number>, newcomer: Task): number {
  let moved = 0
  let guard = 0
  while ((loads.get(day) ?? 0) > SOFT_CAP_MIN && guard++ < 10) {
    const victims = taskDao
      .activeTasksOnDay(day)
      .filter((t) => t.id !== newcomer.id && !t.manualLocked && rank(t) < rank(newcomer))
      .sort((a, b) => rank(a) - rank(b) || a.estimateMin - b.estimateMin)
    if (victims.length === 0) break
    const victim = victims[0]
    const time = victim.dueAt!.slice(11) // 保留原时刻 HH:MM:SS
    const next = addDays(day, 1)
    taskDao.displaceTaskTo(victim.id, `${next}T${time}`)
    loads.set(day, (loads.get(day) ?? 0) - victim.estimateMin)
    loads.set(next, (loads.get(next) ?? 0) + victim.estimateMin)
    moved++
  }
  return moved
}

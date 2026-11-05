// ===== 批量计划导入：AI 整段解析 → 按天分配；规则兜底按行拆分 =====

import type { AppSettings, BatchParsedTask } from '@shared/types'
import { chatCompletion, isAiConfigured, AiClientError } from './client'
import { todayContext } from './prompt'
import { ruleAnalyze, localSummary, extractDueDate, toLocalIso, fmtDay } from './rules'

const BATCH_SYSTEM = `你是一个周计划解析助手。用户会粘贴一段日程计划（可能来自 AI 对话、笔记、文档），主要有两类分组：
1. 具体日期组：如"10/22 周四"、"周三"、"Day 3"，每天下面有若干条任务；
2. 范围组：如"第 1 周（10/19–10/25）打地基"、"本周（10/20–10/26）"，只给了范围没定到天，下面是要在这个范围内完成的任务。

你只输出一个 JSON 对象，不输出任何其他文字：
{
  "tasks": [
    {
      "content": "任务原文或整理后的一句话（保留关键细节，50字内）",
      "importance": 1-5 整数,
      "urgency": 1-5 整数,
      "category": "工作"|"生活"|"学习"|"其他",
      "tags": 0-3 个中文标签数组,
      "estimate_min": 15|30|60|120|240 之一,
      "due_at": 具体日期组的任务：该天日期 "YYYY-MM-DDT23:59:00"；范围组的任务：null
      "range_start": 范围组任务：范围第一天 "YYYY-MM-DD"；具体日期组任务：null
      "range_end": 范围组任务：范围最后一天 "YYYY-MM-DD"；具体日期组任务：null
    }
  ]
}

解析规则：
- 把计划拆成一条条独立任务，粒度按原文（原文一行一行的就按行；一段话描述多件事就拆开）
- 具体日期组的任务：due_at 按所在日期组解析（"10/22 周四"→今年10月22日；"周三"→最近的周三，今天就是周三则取今天；"今天"→今天）
- 范围组的任务：due_at 必须为 null，range_start/range_end 填范围的起止日期（"第 1 周（10/19–10/25）"→ range_start="2026-10-19", range_end="2026-10-25"）。不要猜具体哪天，系统会自动均衡分配到范围内各天
- 用户说"今天是周三"时，"周三"指今天；日期已过的按明年处理
- 产出/验收信息（如"截图"、"git branch -vv 显示"）合并进对应任务的 content 里，不要单独成任务
- 纯说明性文字（如标题"二、本周剩余日程"）不要生成任务
- 若某天有多件事但只有总时长说明（如"1.5–2h"），不用管时长，任务照拆
- 截止时间只写日期（"10/21 周二前"→ 10/21），不带具体时刻`

/** AI 批量解析：返回拆好的任务数组 */
export async function aiBatchParse(settings: AppSettings, text: string): Promise<BatchParsedTask[]> {
  const raw = await chatCompletion(settings, [
    { role: 'system', content: BATCH_SYSTEM },
    { role: 'user', content: `${todayContext()}\n计划原文：\n${text}` }
  ], { jsonMode: true, temperature: 0.2, timeoutMs: 60_000 })

  let obj: { tasks?: unknown } | null = null
  try {
    obj = JSON.parse(raw.trim())
  } catch {
    const brace = raw.match(/\{[\s\S]*\}/)
    if (brace) {
      try { obj = JSON.parse(brace[0]) } catch { obj = null }
    }
  }
  if (!obj || !Array.isArray(obj.tasks)) {
    throw new AiClientError('AI 未返回任务数组')
  }

  // 原文范围兜底：AI 漏返回 range 字段时，从计划原文提取 M/D–M/D 范围（周计划常见格式）
  const sourceRange = extractRangeFromText(text)

  const categories = ['工作', '生活', '学习', '其他']
  const out: BatchParsedTask[] = []
  for (const item of obj.tasks) {
    if (!item || typeof item !== 'object') continue
    const t = item as Record<string, unknown>
    if (typeof t.content !== 'string' || !t.content.trim()) continue
    const rule = ruleAnalyze(t.content)

    // 范围校验：start ≤ end、跨度 ≤ 60 天、结束日不早于今天-1、不超 3 年 → 否则当无效范围丢弃
    // 注：起始日允许已过去（"第 1 周（10/19–10/25）"今天 10/21 才导入很常见，调度器会自动截到今天）
    let rangeStart: string | null = normalizeRangeDay(t.range_start, true)
    let rangeEnd: string | null = normalizeRangeDay(t.range_end, false)
    if (rangeStart && rangeEnd) {
      if (rangeStart > rangeEnd) [rangeStart, rangeEnd] = [rangeEnd, rangeStart] // AI 写反了 → 交换
      const span = Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86_400_000)
      if (span > 60) {
        rangeStart = null
        rangeEnd = null
      }
    } else {
      rangeStart = null
      rangeEnd = null
    }

    // 兜底：AI 标了 due_at=null 但没给 range（认为该任务属于范围组却漏填字段）→ 用原文范围
    if (!rangeStart && !t.due_at && sourceRange) {
      rangeStart = sourceRange.start
      rangeEnd = sourceRange.end
    }

    // 有有效范围 → due_at 忽略（调度器分配）；无范围 → 按日期组解析
    const due = rangeStart ? null : normalizeDay(t.due_at, extractDueDate(t.content))

    out.push({
      content: t.content.trim().slice(0, 120),
      importance: clampInt(t.importance, 1, 5, rule.importance),
      urgency: clampInt(t.urgency, 1, 5, rule.urgency),
      category: categories.includes(t.category as string) ? (t.category as BatchParsedTask['category']) : rule.category,
      tags: Array.isArray(t.tags)
        ? t.tags.filter((x): x is string => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 10)).slice(0, 3)
        : rule.tags,
      estimateMin: [15, 30, 60, 120, 240].includes(Number(t.estimate_min)) ? Number(t.estimate_min) : 30,
      dueAt: due,
      rangeStart,
      rangeEnd
    })
    if (out.length >= 60) break // 上限保护
  }
  if (out.length === 0) throw new AiClientError('AI 没有解析出任何任务')
  return out
}

/** 从计划原文提取首个 M/D–M/D 范围（"第 1 周（10/19–10/25）打地基"）→ {start, end}；无则 null */
export function extractRangeFromText(text: string): { start: string; end: string } | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\s*[–—~-]\s*(\d{1,2})\/(\d{1,2})/)
  if (!m) return null
  const now = new Date()
  const mk = (mo: string, da: string): Date => new Date(now.getFullYear(), Number(mo) - 1, Number(da))
  let s = mk(m[1], m[2])
  const e = mk(m[3], m[4])
  // 结束日不能早于今天-1（全过期范围无意义）；跨度 ≤ 60 天
  if (e.getTime() < now.getTime() - 86_400_000) return null
  if (e.getTime() - s.getTime() > 60 * 86_400_000) return null
  if (s > e) s = new Date(e) // 写反了
  const p = (n: number): string => String(n).padStart(2, '0')
  return {
    start: `${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())}`,
    end: `${e.getFullYear()}-${p(e.getMonth() + 1)}-${p(e.getDate())}`
  }
}

/** 校验 AI 给的 range 日：合法且在 [今天-60天, 今天+3年]（结束日进一步要求 ≥ 今天-1，避免整段范围都已过期）
 *  allowPast=true 用于起始日（周计划开头几天已过去很正常，调度器会把过去截到今天） */
function normalizeRangeDay(raw: unknown, allowPast: boolean): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null
  const day = raw.slice(0, 10)
  const d = new Date(`${day}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const now = Date.now()
  const pastLimit = allowPast ? 60 : 1
  if (d.getTime() < now - pastLimit * 86_400_000) return null
  if (d.getTime() > now + 3 * 365 * 86_400_000) return null
  return day
}

/** 规则兜底：按行拆分 + 行内日期提取 + 相邻日期组延续 + 范围组识别 */
export function ruleBatchParse(text: string): BatchParsedTask[] {
  const out: BatchParsedTask[] = []
  let currentDate: Date | null = null
  let curRange: { start: string; end: string } | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    // 范围组标题行：第 1 周（10/19–10/25）/ 本周（10/20-10/26）/ 10/19–10/25
    const rangeMatch = line.match(/(\d{1,2})\/(\d{1,2})\s*[–—~-]\s*(\d{1,2})\/(\d{1,2})/)
    if (rangeMatch) {
      const now = new Date()
      const mk = (mo: string, da: string): Date => new Date(now.getFullYear(), Number(mo) - 1, Number(da), 23, 59)
      let s = mk(rangeMatch[1], rangeMatch[2])
      const e = mk(rangeMatch[3], rangeMatch[4])
      if (e.getTime() >= s.getTime() - 7 * 86_400_000 && e.getTime() >= now.getTime() - 86_400_000) {
        if (s < now) s = new Date(now) // 起点已过 → 从今天截取
        curRange = { start: fmtDay(s), end: fmtDay(e) }
        currentDate = null
        continue
      }
    }

    // 日期组标题行：10/21、10月22日、周三、周四（10/22 周四）
    const dayMatch =
      line.match(/(\d{1,2})\/(\d{1,2})/) || // 10/22
      line.match(/(\d{1,2})月(\d{1,2})[日号]/) || // 10月22日
      line.match(/^[（(【\[]?\s*(周[一二三四五六日天])\s*[)）】\]]?$/) // 周三（整行）
    if (dayMatch) {
      const now = new Date()
      if (dayMatch[1] && dayMatch[2]) {
        let d = new Date(now.getFullYear(), Number(dayMatch[1]) - 1, Number(dayMatch[2]), 23, 59)
        if (d.getTime() < now.getTime() - 24 * 3600_000) d = new Date(now.getFullYear() + 1, Number(dayMatch[1]) - 1, Number(dayMatch[2]), 23, 59)
        currentDate = d
      } else {
        const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
        const target = map[dayMatch[1]] ?? now.getDay()
        let delta = (target - now.getDay() + 7) % 7
        if (delta === 0 && !/今天/.test(line)) delta = 0 // 周三在周三说 → 今天
        currentDate = new Date(now)
        currentDate.setDate(currentDate.getDate() + delta)
        currentDate.setHours(23, 59, 0, 0)
      }
      curRange = null // 进入具体日期组，退出范围模式
      continue
    }

    // 任务行（跳过纯符号/标题编号）
    const pushTask = (content: string): void => {
      const rule = ruleAnalyze(content)
      out.push({
        content: content.slice(0, 120),
        importance: rule.importance,
        urgency: rule.urgency,
        category: rule.category,
        tags: rule.tags,
        estimateMin: rule.estimateMin,
        dueAt: curRange ? null : currentDate ? toLocalIso(currentDate) : extractDueDate(content),
        rangeStart: curRange?.start ?? null,
        rangeEnd: curRange?.end ?? null
      })
    }

    if (/^[-–—*•·]+\s*/.test(line)) {
      const content = line.replace(/^[-–—*•·]+\s*/, '')
      if (content.length < 2) continue
      pushTask(content)
    } else if (line.length >= 4 && !/^[（(【\[\d一二三四五六七八九十、.]{1,3}$/.test(line)) {
      // 无符号前缀的普通行也当任务（如示例里的整段描述）
      pushTask(line)
    }
    if (out.length >= 60) break
  }
  return out
}

/** 校验 AI 给的 due_at：合法日期且在 [今天-1, 今天+3年] → 当天 23:59；否则用 fallback */
function normalizeDay(raw: unknown, fallback: string | null): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return fallback
  const now = Date.now()
  if (d.getTime() < now - 24 * 3600_000) return fallback
  if (d.getTime() > now + 3 * 365 * 24 * 3600_000) return fallback
  d.setHours(23, 59, 0, 0)
  return toLocalIso(d)
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export { localSummary }

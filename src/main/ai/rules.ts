// ===== 规则降级引擎（AI 未配置/失败时的兜底分析）=====

import type { AiAnalysisResult } from '@shared/types'

const URGENT_WORDS = ['急', '尽快', '马上', '立刻', '加急', '务必', '今天必须']
const HEAVY_WORDS = ['交', '报告', '账单', '缴费', '截止', '截止日', '报销', '申报', '审批', '面试', '考试', '还款']

/** 规则分析：关键词打分 + 正则提截止时间（无 AI 时的兜底；summary 走本地截断） */
export function ruleAnalyze(content: string): AiAnalysisResult {
  let importance = 3
  let urgency = 3

  for (const w of URGENT_WORDS) {
    if (content.includes(w)) {
      urgency = 5
      break
    }
  }
  for (const w of HEAVY_WORDS) {
    if (content.includes(w)) {
      importance = Math.min(5, importance + 1)
      urgency = Math.min(5, urgency + 1)
      break
    }
  }

  return {
    summary: localSummary(content),
    importance,
    urgency,
    category: guessCategory(content),
    tags: guessTags(content),
    estimateMin: 30,
    dueAt: extractDueDate(content)
  }
}

/** 本地一句话提炼：长文本截前 30 字（去空白换行），短句原样 */
export function localSummary(content: string): string | null {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (clean.length <= 30) return clean || null
  return clean.slice(0, 29) + '…'
}

function guessCategory(content: string): AiAnalysisResult['category'] {
  if (/会议|报告|周报|客户|项目|汇报|邮件|报销|加班|领导/.test(content)) return '工作'
  if (/买|缴费|水电|房租|家里|体检|医院|挂号|家人|生日|朋友/.test(content)) return '生活'
  if (/学|课|书|复习|考试|论文|背单词|练习/.test(content)) return '学习'
  return '其他'
}

function guessTags(content: string): string[] {
  const tags: string[] = []
  if (/报告|周报|汇报/.test(content)) tags.push('汇报')
  if (/缴费|账单|还款|水电/.test(content)) tags.push('缴费')
  if (/买|购/.test(content)) tags.push('购物')
  if (/医院|体检|挂号/.test(content)) tags.push('健康')
  return tags.slice(0, 3)
}

/** 正则提取相对日期 → ISO8601；提取不到返回 null */
export function extractDueDate(content: string, now = new Date()): string | null {
  // 明天/后天（可带上午/下午/晚上）
  let m = content.match(/(明天|后天)(?:上午|早上)?(\d{1,2})[点时:：]?(\d{2})?/)
  if (m) return shiftDays(now, m[1] === '明天' ? 1 : 2, timeOfDay(m[2], m[1] === '明天' ? 9 : 9))
  if (/(明天|后天)/.test(content)) {
    const day = content.includes('后天') ? 2 : 1
    return shiftDays(now, day, content.includes('下午') ? 14 : content.includes('晚上') ? 20 : 9)
  }

  // 周X（前/之前/这周/下周）
  m = content.match(/(下?周)([一二三四五六日天])/)
  if (m) {
    const target = weekdayNum(m[2])
    const cur = now.getDay()
    let delta: number
    if (m[1] === '下周') {
      // 下周X = 下一个自然周的周X
      const nextMondayDelta = ((8 - cur) % 7) || 7 // 距下周一的天数
      delta = nextMondayDelta + (target === 1 ? 0 : target - 1)
    } else {
      delta = (target - cur + 7) % 7
      if (delta === 0) delta = 7 // "周三"在周三说 → 下周三
    }
    return shiftDays(now, delta, content.includes('前') ? 18 : 12)
  }

  // X号 / X月X号
  m = content.match(/(\d{1,2})月(\d{1,2})[号日]/)
  if (m) {
    const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), 23, 59)
    if (d.getTime() > now.getTime()) return toLocalIso(d)
    d.setFullYear(d.getFullYear() + 1)
    return toLocalIso(d)
  }
  m = content.match(/(\d{1,2})[号日]/)
  if (m) {
    const day = Number(m[1])
    let d = new Date(now.getFullYear(), now.getMonth(), day, 23, 59)
    if (d.getTime() <= now.getTime()) d = new Date(now.getFullYear(), now.getMonth() + 1, day, 23, 59)
    return toLocalIso(d)
  }

  // M/D（如 10/21 周二前）；排除 X/X–X/X 范围写法（前后还有 – 或另一日期的）
  m = content.match(/(?<![\d/–—~])(\d{1,2})\/(\d{1,2})(?![\d/–—~])/)
  if (m) {
    const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), 23, 59)
    if (d.getTime() > now.getTime()) return toLocalIso(d)
    d.setFullYear(d.getFullYear() + 1)
    return toLocalIso(d)
  }

  // 月底
  if (/月底/.test(content)) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59)
    if (d.getTime() > now.getTime() + 3600_000) return toLocalIso(d)
    return toLocalIso(new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59))
  }

  // 今天/今晚
  if (/今晚/.test(content)) return shiftDays(now, 0, 21)
  if (/今天|今日/.test(content)) return shiftDays(now, 0, 23, 59)

  return null
}

function weekdayNum(ch: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
  return map[ch] ?? 1
}

function timeOfDay(hourStr: string | undefined, fallback: number): { h: number; m: number } {
  const h = hourStr ? Number(hourStr) : fallback
  return { h, m: 0 }
}

function shiftDays(now: Date, days: number, h: number, m = 0): string {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  d.setHours(h, m, 0, 0)
  return toLocalIso(d)
}

/** 本地时间 → 无时区后缀的 ISO8601（与 AI 返回格式一致，两端 new Date() 解析为本地时间） */
export function toLocalIso(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
}

/** "YYYY-MM-DD" → Date（本地 0 点，用于按天计算） */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Date → "YYYY-MM-DD" */
export function fmtDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** d + n 天 → "YYYY-MM-DD" */
export function addDays(day: string, n: number): string {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return fmtDay(d)
}

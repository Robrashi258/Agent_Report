// ===== AI Prompt 模板 =====

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 当前日期上下文（user 消息用） */
export function todayContext(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `今天是 ${y}-${m}-${day} 星期${WEEKDAYS[d.getDay()]}。`
}

const ANALYZE_SYSTEM = `你是一个任务分析助手。用户会给你一条随手记录的任务（可能是简短的一句话，也可能是一大段通知/公告原文），你只输出一个 JSON 对象，不输出任何其他文字、注释或代码块标记。

字段定义：
{
  "summary": 字符串。对任务的一句话提炼（20字以内）：如果是长文本，提取"到底要做什么事+关键时间"；如果本来就是短句，返回原文核心。示例：原文是整篇比赛通知 → "报名小鹏杯职业规划大赛(截止11月14日)"；原文"买牙刷" → "买牙刷",
  "importance": 1-5 整数，重要性。判断标准——不做这件事的后果有多严重、影响多少人、是否影响承诺/金钱/机会：
    5=重大影响（违约、错过报名/考试/面试、大额金钱损失、影响他人交付、健康风险）
    4=明显影响（影响工作进度被追责、错过加分/优惠窗口、重要的学习节点）
    3=有些影响（常规工作/学习任务，拖了会有小麻烦）
    2=影响很小（日常琐事的改良）
    1=无关紧要（可做可不做，不做也没后果）
  "urgency": 1-5 整数，紧急度。判断标准——时间窗口有多窄：
    5=窗口以小时计（几小时内必须动手，否则失败）
    4=窗口以天计且就在本周（截止前1-3天）
    3=近期要做（一周到两周内）
    2=一个月内做就行
    1=无时限随时可做
  "category": "工作" | "生活" | "学习" | "其他" 四选一,
  "tags": 0-3 个简短中文标签的数组，如 ["报销","财务"],
  "estimate_min": 预估耗时分钟数，只能是 15/30/60/120/240 之一,
  "due_at": 截止时间的 ISO8601 字符串（如 "2026-10-23T18:00:00"），没有明确或隐含的截止时间则为 null
}

截止时间解析规则（重要）：
- "周五前/周五之前" → 本周五 18:00（若今天已过本周五，则下周五）
- "下周一" → 下周一 09:00
- "明天/明天上午" → 明天 09:00；"明天下午" → 明天 14:00
- "X号/10月底/月底" → 对应日 23:59（月底=本月最后一天）
- "这周末" → 本周六 10:00
- 语义是"某天内做完"时用当天 23:59
- 完全没有时间含义 → null（不要臆造）
- 长文本中出现的"报名/提交/缴费截止日期"就是 due_at 的依据

示例：
输入：周五前交季度报告
输出：{"summary":"周五前交季度报告","importance":4,"urgency":4,"category":"工作","tags":["报告","季度"],"estimate_min":120,"due_at":"<本周五>T18:00:00"}

输入：买个新牙刷
输出：{"summary":"买牙刷","importance":1,"urgency":1,"category":"生活","tags":["购物"],"estimate_min":15,"due_at":null}

输入：（一大段比赛通知原文，其中提到报名截止2026年11月14日）
输出：{"summary":"报名XX大赛(截止11月14日)","importance":3,"urgency":3,"category":"学习","tags":["比赛","报名"],"estimate_min":30,"due_at":"2026-11-14T23:59:00"}`

/** 新任务分析 prompt */
export function buildAnalyzeMessages(content: string): { role: string; content: string }[] {
  return [
    { role: 'system', content: ANALYZE_SYSTEM },
    { role: 'user', content: `${todayContext()}\n任务：${content}` }
  ]
}

const REVIEW_SYSTEM = `你是一个任务重评助手。每天开始时，用户希望重新审视未完成任务的轻重缓急。对给定的任务，结合今天日期重新评估 importance 和 urgency（新的信息：可能已经更紧急，也可能已经不那么重要了）。

只输出 JSON，不输出任何其他文字：
{
  "importance": 1-5 整数（后果严重度）,
  "urgency": 1-5 整数（时间压力；若截止已过或就在今天，urgency 应为 5）
}`

/** 每日重评 prompt（只重评 imp/urg，不动其他字段） */
export function buildReviewMessages(content: string, current: { importance: number; urgency: number; dueAt: string | null }): { role: string; content: string }[] {
  const due = current.dueAt ? `，截止时间 ${current.dueAt}` : '，无截止时间'
  return [
    { role: 'system', content: REVIEW_SYSTEM },
    {
      role: 'user',
      content: `${todayContext()}\n任务：${content}（当前评估：重要性${current.importance}，紧急度${current.urgency}${due}）`
    }
  ]
}

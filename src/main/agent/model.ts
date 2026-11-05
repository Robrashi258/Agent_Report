import type { AppSettings } from '@shared/types'
import { normalizeBaseUrl } from '../ai/client'

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}
export interface ToolDefinition {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}
export type ModelTransport = (
  settings: AppSettings, messages: ModelMessage[], tools: ToolDefinition[], signal: AbortSignal
) => Promise<ModelMessage>

// 独立保留原生tool_calls消息，不改变0.1文字分析客户端的接口。
export const requestAgentTurn: ModelTransport = async (settings, messages, tools, signal) => {
  const response = await fetch(`${normalizeBaseUrl(settings.aiBaseUrl)}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.aiApiKey}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    body: JSON.stringify({ model: settings.aiModel, messages, tools, tool_choice: 'auto',
      parallel_tool_calls: false, temperature: 0.2, max_tokens: 1800 })
  })
  if (!response.ok) {
    // 不把可能包含凭据/原文的服务端错误正文持久化到运行日志。
    throw new Error(`模型请求失败（HTTP ${response.status}），请检查设置、额度和工具调用支持。`)
  }
  const data = await response.json() as { choices?: { message?: ModelMessage }[] }
  const raw = data.choices?.[0]?.message
  if (!raw) throw new Error('模型未返回消息。')
  const calls = raw.tool_calls
  if (calls !== undefined && (!Array.isArray(calls) || calls.length > 4 || calls.some(c =>
    !c || c.type !== 'function' || typeof c.id !== 'string' || !c.id || c.id.length > 200 ||
    typeof c.function?.name !== 'string' || typeof c.function?.arguments !== 'string' || c.function.arguments.length > 12000
  ) || new Set(calls.map(c => c.id)).size !== calls.length)) throw new Error('模型工具调用格式无效。')
  const content = typeof raw.content === 'string' ? raw.content.slice(0, 12000) : null
  if (!content && !calls?.length) throw new Error('模型返回为空；请使用支持工具调用的非推理模式。')
  return { role: 'assistant', content, ...(calls?.length ? { tool_calls: calls } : {}) }
}

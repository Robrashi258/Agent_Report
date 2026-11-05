export type RunStatus = 'running' | 'waiting_user' | 'awaiting_confirmation' | 'completed' | 'cancelled' | 'failed'
export interface AgentEvent {
  id: number
  kind: 'user' | 'assistant' | 'tool' | 'status'
  text: string
  createdAt: string
}
export interface PriorityChange {
  taskId: number
  title: string
  expectedUpdatedAt: string
  before: { importance: number; urgency: number }
  after: { importance: number; urgency: number }
  reason: string
}
export interface AgentRun {
  id: string
  goal: string
  status: RunStatus
  events: AgentEvent[]
  pending: PriorityChange | null
  updatedAt: string
}
export const AGENT_IPC = {
  start: 'agent:start', send: 'agent:send', latest: 'agent:latest', get: 'agent:get',
  confirm: 'agent:confirm', cancel: 'agent:cancel', changed: 'agent:changed'
} as const

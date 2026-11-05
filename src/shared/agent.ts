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
  pending: PendingChange | null
  updatedAt: string
  scene: string
  draftId: string | null
  draftState: 'editing' | 'committed' | 'discarded' | null
  createdTaskIds: number[]
}
export interface RunSummary { id: string; goal: string; status: RunStatus; scene: string; updatedAt: string; draftState: AgentRun['draftState'] }
export const AGENT_IPC = {
  start: 'agent:start', send: 'agent:send', latest: 'agent:latest', get: 'agent:get',
  confirm: 'agent:confirm', cancel: 'agent:cancel', changed: 'agent:changed', history: 'agent:history'
} as const
import type { PlanChange } from './planning'
import type { MemoryChange } from './profile'
import type { TaskDraftChange } from './drafts'
export type PendingChange = PriorityChange | PlanChange | MemoryChange | TaskDraftChange

export interface MemoryFact { id: string; scope: string; key: string; value: string; source: string; version: number; expiresAt: string | null; updatedAt: string }
export interface MemoryInput { scope: string; key: string; value: string; expiresAt?: string | null }
export interface MemoryChange { type: 'memory'; fact: MemoryInput; expectedVersion: number | null; before: MemoryFact | null }
export interface CompletionEvent {
  id: string; taskId: number; cycle: number; title: string; groupKey: string; estimateSource: string
  baseMin: number; plannedMin: number; hadPlan: boolean; createdAt: string; valid: boolean
}
export type Difficulty = 'unknown' | 'easy' | 'fit' | 'hard'
export interface FeedbackInput { eventId: string; actualMin: number | null; difficulty: Difficulty; interrupted: boolean; scopeChanged: boolean; note: string }
export interface CompletionDetail { event: CompletionEvent; feedback: FeedbackInput | null }
export interface FollowupMessage {
  id: string; eventId: string; title: string; question: string; fields: string[]
  state: 'open' | 'answered' | 'dismissed' | 'cancelled' | 'expired'; read: boolean; createdAt: string; expiresAt: string
  event: CompletionEvent
}
export interface ProfileState {
  messages: FollowupMessage[]; unread: number; enabled: boolean; calibrationEnabled: boolean
  pendingJobs: number; failedJobs: number
}
export interface DurationEstimate {
  baseMin: number; estimateMin: number; groupKey: string; source: string; sampleCount: number; factor: number; applied: boolean
}
export const PROFILE_IPC = {
  memoryList: 'profile:memoryList', memorySave: 'profile:memorySave', memoryRemove: 'profile:memoryRemove',
  estimate: 'profile:estimate', state: 'profile:state', enabled: 'profile:enabled', calibration: 'profile:calibration',
  read: 'profile:read', dismiss: 'profile:dismiss', feedback: 'profile:feedback', completion: 'profile:completion',
  retry: 'profile:retry', changed: 'profile:changed'
} as const

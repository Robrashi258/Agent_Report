export type DeadlineMode = 'unknown' | 'none' | 'set'
export interface DraftItem {
  id: string; content: string; estimateMin: number | null; estimateGroup: string
  importance: number; urgency: number; category: '工作' | '生活' | '学习' | '其他'
  deadlineMode: DeadlineMode; deadlineAt: string | null; windowStart: string | null; windowEnd: string | null
  included: boolean; note: string; origin: 'model' | 'user' | 'import' | 'review'
}
export interface TaskDraft {
  id: string; runId: string; version: number; state: 'editing' | 'committed' | 'discarded'
  sourceKind: string; sourceText: string; sourceRef: string; items: DraftItem[]; createdTaskIds: number[]; updatedAt: string
}
export interface TaskDraftChange { type: 'task_draft'; draftId: string; expectedVersion: number }
export const DRAFT_IPC = {
  capture: 'draft:capture', batch: 'draft:batch', get: 'draft:get', save: 'draft:save', add: 'draft:add',
  continuePlan: 'draft:continuePlan', mockReview: 'draft:mockReview'
  ,confirm: 'draft:confirm'
} as const

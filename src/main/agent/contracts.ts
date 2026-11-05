import type { PendingChange, RunStatus } from '@shared/agent'
export const SCENE_CONTRACT_VERSION = '1.0'
export interface ToolContext { observed: Map<number, string>; runId?: string }
export interface ToolResult {
  ok: boolean; data?: unknown; errorCode?: string; message?: string; sourceRefs?: string[]; stateVersion?: string | number
  pause?: Extract<RunStatus, 'waiting_user' | 'awaiting_confirmation' | 'completed'>; pending?: PendingChange
}

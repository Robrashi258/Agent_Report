import { reactive, readonly } from 'vue'
import type { ProfileState } from '@shared/profile'
const state = reactive<ProfileState & { error: string }>({ messages: [], unread: 0, enabled: true, calibrationEnabled: true, pendingJobs: 0, failedJobs: 0, error: '' })
let sequence = 0
export async function refreshFeedback(): Promise<void> {
  const id = ++sequence
  try { const result = await window.api.profileState(); if (id === sequence) Object.assign(state, result, { error: '' }) }
  catch (e) { if (id === sequence) state.error = e instanceof Error ? e.message : String(e) }
}
export function startFeedbackListener(): () => void {
  void refreshFeedback()
  const offProfile = window.api.onProfileChanged(() => void refreshFeedback())
  const offTasks = window.api.onTaskChanged(() => void refreshFeedback())
  const timer = setInterval(() => void refreshFeedback(), 60000)
  return () => { offProfile(); offTasks(); clearInterval(timer) }
}
export const feedbackState = readonly(state)

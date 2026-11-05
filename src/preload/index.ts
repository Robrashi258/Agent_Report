import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppSettings, type Task, type TaskCreateInput, type TaskFilter, type TaskUpdateInput, type BatchCreateResult, type ChainGroup, type RebalanceResult } from '../shared/types'
import { AGENT_IPC, type AgentRun } from '../shared/agent'
import { PLANNING_IPC, type PlanningSnapshot, type CourseInput, type PlanningSettings, type PlanPreview } from '../shared/planning'
import { PROFILE_IPC, type MemoryFact, type MemoryInput, type DurationEstimate, type ProfileState, type CompletionDetail, type FeedbackInput } from '../shared/profile'

const api = {
  memoryList: (): Promise<MemoryFact[]> => ipcRenderer.invoke(PROFILE_IPC.memoryList),
  memorySave: (input: MemoryInput, version: number | null): Promise<MemoryFact> => ipcRenderer.invoke(PROFILE_IPC.memorySave, input, version),
  memoryRemove: (id: string, version: number): Promise<void> => ipcRenderer.invoke(PROFILE_IPC.memoryRemove, id, version),
  durationEstimate: (taskId: number): Promise<DurationEstimate> => ipcRenderer.invoke(PROFILE_IPC.estimate, taskId),
  profileState: (): Promise<ProfileState> => ipcRenderer.invoke(PROFILE_IPC.state),
  feedbackEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke(PROFILE_IPC.enabled, enabled),
  calibrationEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke(PROFILE_IPC.calibration, enabled),
  messageRead: (id: string): Promise<void> => ipcRenderer.invoke(PROFILE_IPC.read, id),
  messageDismiss: (id: string): Promise<void> => ipcRenderer.invoke(PROFILE_IPC.dismiss, id),
  completionForTask: (id: number): Promise<CompletionDetail | null> => ipcRenderer.invoke(PROFILE_IPC.completion, id),
  feedbackSave: (input: FeedbackInput, messageId?: string): Promise<void> => ipcRenderer.invoke(PROFILE_IPC.feedback, input, messageId),
  feedbackRetry: (): Promise<void> => ipcRenderer.invoke(PROFILE_IPC.retry),
  onProfileChanged: (cb: () => void): (() => void) => { const listener = (): void => cb(); ipcRenderer.on(PROFILE_IPC.changed, listener); return () => ipcRenderer.removeListener(PROFILE_IPC.changed, listener) },
  planningRead: (start: string, end: string): Promise<PlanningSnapshot> => ipcRenderer.invoke(PLANNING_IPC.read, start, end),
  courseSave: (input: CourseInput): Promise<void> => ipcRenderer.invoke(PLANNING_IPC.saveCourse, input),
  courseDelete: (id: number): Promise<void> => ipcRenderer.invoke(PLANNING_IPC.deleteCourse, id),
  planningSettings: (input: PlanningSettings): Promise<void> => ipcRenderer.invoke(PLANNING_IPC.settings, input),
  planningPreview: (ids: number[], start: string, end: string): Promise<PlanPreview> => ipcRenderer.invoke(PLANNING_IPC.preview, ids, start, end),
  planningCommit: (id: string): Promise<{ saved: true; count: number }> => ipcRenderer.invoke(PLANNING_IPC.commit, id),
  planningLock: (id: number, locked: boolean): Promise<void> => ipcRenderer.invoke(PLANNING_IPC.lock, id, locked),
  planningRemove: (id: number): Promise<void> => ipcRenderer.invoke(PLANNING_IPC.remove, id),
  agentStart: (goal: string): Promise<AgentRun> => ipcRenderer.invoke(AGENT_IPC.start, goal),
  agentSend: (id: string, text: string): Promise<AgentRun> => ipcRenderer.invoke(AGENT_IPC.send, id, text),
  agentLatest: (): Promise<AgentRun | null> => ipcRenderer.invoke(AGENT_IPC.latest),
  agentGet: (id: string): Promise<AgentRun> => ipcRenderer.invoke(AGENT_IPC.get, id),
  agentConfirm: (id: string, accepted: boolean): Promise<AgentRun> => ipcRenderer.invoke(AGENT_IPC.confirm, id, accepted),
  agentCancel: (id: string): Promise<AgentRun> => ipcRenderer.invoke(AGENT_IPC.cancel, id),
  onAgentChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(AGENT_IPC.changed, listener)
    return () => ipcRenderer.removeListener(AGENT_IPC.changed, listener)
  },
  taskCreate: (input: TaskCreateInput): Promise<Task> => ipcRenderer.invoke(IPC.taskCreate, input),
  taskBatchCreate: (text: string): Promise<BatchCreateResult> => ipcRenderer.invoke(IPC.taskBatchCreate, text),
  chainList: (): Promise<ChainGroup[]> => ipcRenderer.invoke(IPC.chainList),
  chainAppend: (projectId: string, content: string): Promise<Task | null> => ipcRenderer.invoke(IPC.chainAppend, projectId, content),
  chainShift: (projectId: string, days: number): Promise<number> => ipcRenderer.invoke(IPC.chainShift, projectId, days),
  chainRemoveTask: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.chainRemoveTask, id),
  scheduleRebalance: (): Promise<RebalanceResult> => ipcRenderer.invoke(IPC.scheduleRebalance),
  projectRebalance: (projectId: string): Promise<RebalanceResult> => ipcRenderer.invoke(IPC.projectRebalance, projectId),
  taskList: (filter?: TaskFilter): Promise<Task[]> => ipcRenderer.invoke(IPC.taskList, filter ?? {}),
  taskUpdate: (input: TaskUpdateInput): Promise<Task | null> => ipcRenderer.invoke(IPC.taskUpdate, input),
  taskComplete: (id: number, done: boolean): Promise<Task | null> => ipcRenderer.invoke(IPC.taskComplete, id, done),
  taskSnooze: (id: number): Promise<{ task: Task | null; chained: number }> => ipcRenderer.invoke(IPC.taskSnooze, id),
  taskDelete: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.taskDelete, id),
  taskRetryAnalyze: (id: number): Promise<boolean> => ipcRenderer.invoke(IPC.taskRetryAnalyze, id),
  projectList: (): Promise<{ projectId: string; title: string; tasks: Task[]; total: number; doneCount: number; firstDue: string | null; lastDue: string | null }[]> => ipcRenderer.invoke(IPC.projectList),
  projectAddStep: (projectId: string, content: string, dueAt: string | null): Promise<Task | null> => ipcRenderer.invoke(IPC.projectAddStep, projectId, content, dueAt),
  projectMoveStep: (id: number, dir: 'up' | 'down'): Promise<boolean> => ipcRenderer.invoke(IPC.projectMoveStep, id, dir),
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsSet, patch),
  settingsTestAi: (): Promise<{ ok: boolean; latencyMs?: number; error?: string }> => ipcRenderer.invoke(IPC.settingsTestAi),
  onTaskChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.taskChanged, listener)
    return () => ipcRenderer.removeListener(IPC.taskChanged, listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)

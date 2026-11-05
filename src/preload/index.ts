import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppSettings, type Task, type TaskCreateInput, type TaskFilter, type TaskUpdateInput, type BatchCreateResult, type ChainGroup, type RebalanceResult } from '../shared/types'

const api = {
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

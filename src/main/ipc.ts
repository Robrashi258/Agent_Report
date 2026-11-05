import { ipcMain, type BrowserWindow } from 'electron'
import { IPC, type AppSettings, type Task, type TaskCreateInput, type TaskFilter, type TaskUpdateInput, type BatchCreateResult } from '@shared/types'
import * as taskDao from './db/taskDao'
import type { ChainGroup } from '@shared/types'
import { getSettings, setSettings } from './db/settingsDao'
import { enqueueAnalyze, retryAnalyze, setBroadcastFn } from './ai/analyzer'
import { testConnection, isAiConfigured } from './ai/client'
import { aiBatchParse, ruleBatchParse } from './ai/batch'
import type { RebalanceResult } from '@shared/types'
import { AGENT_IPC } from '@shared/agent'
import * as agent from './agent/runner'
import * as agentStore from './agent/store'
import { PLANNING_IPC } from '@shared/planning'
import * as planning from './planning/service'

/** 广播任务变化（分析完成/手机端操作后刷新所有视图） */
export function broadcastTaskChanged(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.taskChanged)
  }
}

export function registerIpcHandlers(getWin: () => BrowserWindow | null): void {
  const changed = (): void => broadcastTaskChanged(getWin())
  ipcMain.handle(PLANNING_IPC.read, (_e, start: string, end: string) => planning.snapshot(start, end))
  ipcMain.handle(PLANNING_IPC.saveCourse, (_e, input) => { planning.saveCourse(input); changed() })
  ipcMain.handle(PLANNING_IPC.deleteCourse, (_e, id: number) => { planning.deleteCourse(id); changed() })
  ipcMain.handle(PLANNING_IPC.settings, (_e, input) => { planning.saveSettings(input); changed() })
  ipcMain.handle(PLANNING_IPC.preview, (_e, ids: number[], start: string, end: string) => planning.preview(ids, start, end))
  ipcMain.handle(PLANNING_IPC.commit, (_e, id: string) => { const result = planning.commit(id, null); changed(); return result })
  ipcMain.handle(PLANNING_IPC.lock, (_e, id: number, locked: boolean) => { planning.lockBlock(id, locked); changed() })
  ipcMain.handle(PLANNING_IPC.remove, (_e, id: number) => { planning.removeBlock(id); changed() })
  setBroadcastFn(() => broadcastTaskChanged(getWin()))
  agentStore.recoverInterruptedRuns()
  agent.setAgentNotify(() => {
    broadcastTaskChanged(getWin())
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(AGENT_IPC.changed)
  })
  ipcMain.handle(AGENT_IPC.start, (_e, goal: unknown) => agent.startRun(goal))
  ipcMain.handle(AGENT_IPC.send, (_e, id: unknown, message: unknown) => agent.sendMessage(id, message))
  ipcMain.handle(AGENT_IPC.latest, () => agentStore.latestRun())
  ipcMain.handle(AGENT_IPC.get, (_e, id: string) => {
    if (typeof id !== 'string' || id.length > 100) throw new Error('对话编号无效。')
    return agentStore.getRun(id)
  })
  ipcMain.handle(AGENT_IPC.confirm, (_e, id: unknown, accepted: unknown) => agent.confirmChange(id, accepted))
  ipcMain.handle(AGENT_IPC.cancel, (_e, id: unknown) => agent.cancelRun(id))

  ipcMain.handle(IPC.taskCreate, (_e, input: TaskCreateInput): Task => {
    const task = taskDao.createTask(input)
    broadcastTaskChanged(getWin())
    enqueueAnalyze(task.id)
    return task
  })

  ipcMain.handle(IPC.taskList, (_e, filter: TaskFilter = {}): Task[] => {
    return taskDao.listTasks(filter)
  })

  ipcMain.handle(IPC.taskUpdate, (_e, input: TaskUpdateInput): Task | null => {
    const task = taskDao.updateTask(input)
    broadcastTaskChanged(getWin())
    return task
  })

  ipcMain.handle(IPC.taskComplete, (_e, id: number, done: boolean): Task | null => {
    const task = taskDao.completeTask(id, done)
    broadcastTaskChanged(getWin())
    return task
  })

  ipcMain.handle(IPC.taskSnooze, (_e, id: number): { task: Task | null; chained: number } => {
    const result = taskDao.snoozeTask(id)
    broadcastTaskChanged(getWin())
    return { task: result?.task ?? null, chained: result?.chained ?? 0 }
  })

  ipcMain.handle(IPC.taskDelete, (_e, id: number): boolean => {
    const ok = taskDao.deleteTask(id)
    if (ok) broadcastTaskChanged(getWin())
    return ok
  })

  ipcMain.handle(IPC.taskRetryAnalyze, (_e, id: number): boolean => {
    retryAnalyze(id)
    return true
  })

  ipcMain.handle(IPC.taskBatchCreate, async (_e, text: string): Promise<BatchCreateResult> => {
    const settings = getSettings()
    let items
    let mode: 'ai' | 'rule'
    if (isAiConfigured(settings)) {
      try {
        items = await aiBatchParse(settings, text)
        mode = 'ai'
      } catch (e) {
        console.warn('[batch] AI 批量解析失败，走规则拆分', e)
        items = ruleBatchParse(text)
        mode = 'rule'
      }
    } else {
      items = ruleBatchParse(text)
      mode = 'rule'
    }
    if (items.length === 0) {
      throw new Error('没有解析出任何任务，请检查粘贴的内容')
    }
    const created = taskDao.batchCreateTasks(items, mode === 'ai' ? 'ok' : 'none')
    // 导入只建立任务，执行安排由新版试排及用户确认保存。
    const assigned = 0
    broadcastTaskChanged(getWin())
    return { created, mode, rebalanced: assigned }
  })

  ipcMain.handle(IPC.scheduleRebalance, (): RebalanceResult => { throw new Error('旧按天分配已停用，请在今日助理或日程中试排。') })

  ipcMain.handle(IPC.projectList, (): taskDao.ProjectGroup[] => taskDao.listProjects())

  ipcMain.handle(IPC.projectAddStep, (_e, projectId: string, content: string, dueAt: string | null): Task | null => {
    const task = taskDao.addChainStep(projectId, content, dueAt)
    broadcastTaskChanged(getWin())
    return task
  })

  ipcMain.handle(IPC.projectMoveStep, (_e, id: number, dir: 'up' | 'down'): boolean => {
    const result = taskDao.moveChainStep(id, dir)
    broadcastTaskChanged(getWin())
    return result !== null
  })

  ipcMain.handle(IPC.chainList, (): ChainGroup[] => taskDao.listChains())

  ipcMain.handle(IPC.chainAppend, (_e, projectId: string, content: string): Task | null => {
    const task = taskDao.appendChainTask(projectId, content)
    if (task) {
      enqueueAnalyze(task.id)
      broadcastTaskChanged(getWin())
    }
    return task
  })

  ipcMain.handle(IPC.chainShift, (_e, projectId: string, days: number): number => {
    throw new Error('旧链条日期平移已停用；请通过新的试排移动执行时间。')
  })

  ipcMain.handle(IPC.chainRemoveTask, (_e, id: number): boolean => {
    const ok = taskDao.removeChainTask(id)
    if (ok) broadcastTaskChanged(getWin())
    return ok
  })

  ipcMain.handle(IPC.projectRebalance, (_e, projectId: string): RebalanceResult => {
    throw new Error('请在今日助理查询此项目任务，再试排具体执行时间。')
  })

  ipcMain.handle(IPC.settingsGet, (): AppSettings => getSettings())

  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>): AppSettings => {
    const result = setSettings(patch)
    return result
  })

  ipcMain.handle(IPC.settingsTestAi, async (): Promise<{ ok: boolean; latencyMs?: number; error?: string }> => {
    const settings = getSettings()
    if (!isAiConfigured(settings)) {
      return { ok: false, error: '请先填写 Base URL、API Key 和模型名' }
    }
    try {
      const latencyMs = await testConnection(settings)
      return { ok: true, latencyMs }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

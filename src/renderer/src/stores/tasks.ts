import { reactive, readonly } from 'vue'
import type { Task, TaskFilter } from '@shared/types'
import type { Task as T } from '@shared/types'

interface TasksState {
  tasks: Task[]
  loaded: boolean
}

const state = reactive<TasksState>({
  tasks: [],
  loaded: false
})

async function refresh(filter?: TaskFilter): Promise<void> {
  state.tasks = await window.api.taskList(filter)
  state.loaded = true
}

async function createTask(content: string): Promise<T> {
  const task = await window.api.taskCreate({ content })
  await refresh()
  return task
}

async function completeTask(id: number, done: boolean): Promise<void> {
  await window.api.taskComplete(id, done)
  await refresh()
}

async function snoozeTask(id: number): Promise<number> {
  const result = await window.api.taskSnooze(id)
  await refresh()
  return result.chained
}

async function updateTask(input: Parameters<typeof window.api.taskUpdate>[0]): Promise<void> {
  await window.api.taskUpdate(input)
  await refresh()
}

async function deleteTask(id: number): Promise<void> {
  await window.api.taskDelete(id)
  await refresh()
}

// 订阅主进程广播（手机端操作/AI 完成时自动刷新）
function initListener(): void {
  window.api.onTaskChanged(() => void refresh())
}

// 初始加载
initListener()
void refresh()

export const tasksStore = readonly(state)
export const tasksActions = {
  refresh,
  createTask,
  completeTask,
  snoozeTask,
  updateTask,
  deleteTask
}

export type { Task }

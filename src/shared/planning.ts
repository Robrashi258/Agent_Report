export interface Course {
  id: number; name: string; weekday: number; startMin: number; endMin: number
  fromDate: string; toDate: string
}
export interface CourseInput { name: string; weekday: number; startMin: number; endMin: number; fromDate: string; toDate: string }
export interface PlanningSettings { startMin: number; endMin: number; dailyMaxMin: number; breakMin: number }
export interface Interval { start: number; end: number }
export interface Occupancy extends Interval { kind: 'course' | 'task'; title: string; taskId?: number; locked?: boolean }
export interface PlanBlock extends Interval { id?: number; taskId: number; title: string; locked: boolean; reason: string }
export interface Unscheduled { taskId: number; title: string; reason: string }
export interface PlanningSnapshot {
  startDate: string; endDate: string; version: string; settings: PlanningSettings
  courses: Course[]; occupied: Occupancy[]; blocks: PlanBlock[]
}
export interface PlanPreview {
  id: string; runId: string | null; startDate: string; endDate: string; version: string; createdAt: string
  taskIds: number[]; blocks: PlanBlock[]; unscheduled: Unscheduled[]; previous: PlanBlock[]
  timeWindow: { startMin: number; endMin: number }
}
export interface PlanChange { type: 'plan'; preview: PlanPreview }
export const PLANNING_IPC = {
  read: 'planning:read', saveCourse: 'planning:saveCourse', deleteCourse: 'planning:deleteCourse',
  settings: 'planning:settings', preview: 'planning:preview', commit: 'planning:commit',
  lock: 'planning:lock', remove: 'planning:remove'
} as const

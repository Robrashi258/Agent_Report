<script setup lang="ts">
import { computed } from 'vue'
import { tasksStore } from '../stores/tasks'
import TaskItem from '../components/TaskItem.vue'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

interface DayGroup {
  key: string
  label: string
  weekday: string
  isToday: boolean
  totalMin: number
  tasks: import('@shared/types').Task[]
}

/** 未来 14 天 + 无日期，按天分组（跳过空天） */
const groups = computed<DayGroup[]>(() => {
  const pending = tasksStore.tasks.filter((t) => t.status === 'pending')
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const byDay = new Map<string, typeof pending>()

  const scheduled: typeof pending = []
  for (const t of pending) {
    if (t.dueAt) {
      const d = new Date(t.dueAt)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key)!.push(t)
    } else {
      scheduled.push(t)
    }
  }

  const out: DayGroup[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const list = byDay.get(key)
    if (!list || list.length === 0) continue
    out.push({
      key,
      label: `${d.getMonth() + 1}月${d.getDate()}日`,
      weekday: WEEKDAYS[d.getDay()],
      isToday: i === 0,
      totalMin: list.reduce((s, t) => s + t.estimateMin, 0),
      tasks: list.slice().sort((a, b) => b.urgency - a.urgency || b.importance - a.importance || (a.chainTotal > 1 && b.chainTotal > 1 ? a.chainOrder - b.chainOrder : 0))
    })
  }

  // 14 天外的远期任务
  const far = pending.filter((t) => {
    if (!t.dueAt) return false
    const d = new Date(t.dueAt)
    return d.getTime() >= today.getTime() + 14 * 24 * 3600_000
  })
  if (far.length) {
    out.push({
      key: 'far',
      label: '更远',
      weekday: '',
      isToday: false,
      totalMin: far.reduce((s, t) => s + t.estimateMin, 0),
      tasks: far
    })
  }

  // 无截止任务
  if (scheduled.length) {
    out.push({
      key: 'none',
      label: '未分配日期',
      weekday: '',
      isToday: false,
      totalMin: scheduled.reduce((s, t) => s + t.estimateMin, 0),
      tasks: scheduled.slice().sort((a, b) => b.importance - a.importance)
    })
  }
  return out
})

function formatTotal(min: number): string {
  if (min < 60) return `${min} 分钟`
  return `${(min / 60).toFixed(min % 60 === 0 ? 0 : 1)} 小时`
}
</script>

<template>
  <div class="schedule-view">
    <header class="view-header">
      <h2>日程</h2>
      <span class="sub">未来两周按天分配（自动跳过空闲日）</span>
    </header>

    <div v-if="groups.length" class="groups">
      <section v-for="g in groups" :key="g.key" class="day-group" :class="{ today: g.isToday, vague: g.key === 'far' || g.key === 'none' }">
        <header class="day-head">
          <span class="day-label">{{ g.label }}</span>
          <span v-if="g.weekday" class="day-week">{{ g.weekday }}</span>
          <span v-if="g.isToday" class="today-tag">今天</span>
          <span class="day-count">{{ g.tasks.length }} 项 · 约 {{ formatTotal(g.totalMin) }}</span>
        </header>
        <div class="zone-list">
          <TaskItem v-for="t in g.tasks" :key="t.id" :task="t" />
        </div>
      </section>
    </div>

    <div v-else class="empty">
      <div class="icon">🗓️</div>
      <p>还没有按天分配的任务</p>
      <p class="hint">点顶部「批量计划」粘贴一段日程（如"10/22 周四：学信号槽、写 date.h"），AI 自动拆分并分配到每天</p>
    </div>
  </div>
</template>

<style scoped>
.view-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.view-header h2 {
  font-size: 20px;
}
.sub {
  color: var(--text-3);
  font-size: 12px;
}
.groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.day-group {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
}
.day-group.today {
  border-color: var(--primary);
  background: var(--primary-light);
}
.day-group.vague {
  opacity: 0.85;
}
.day-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.day-label {
  font-size: 14px;
  font-weight: 600;
}
.day-week {
  font-size: 12px;
  color: var(--text-3);
}
.today-tag {
  font-size: 11px;
  color: #fff;
  background: var(--primary);
  padding: 1px 8px;
  border-radius: 10px;
}
.day-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-3);
}
.zone-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hint {
  font-size: 12px;
  margin-top: 6px;
}
</style>

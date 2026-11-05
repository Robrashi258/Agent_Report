<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TaskCategory, TaskStatus } from '@shared/types'
import { tasksStore } from '../stores/tasks'
import TaskItem from '../components/TaskItem.vue'

const statusFilter = ref<TaskStatus | 'active' | 'all'>('active')
const categoryFilter = ref<TaskCategory | 'all'>('all')

const filtered = computed(() => {
  return tasksStore.tasks.filter((t) => {
    if (statusFilter.value === 'all') return t.status !== 'archived'
    if (statusFilter.value === 'active') return t.status === 'inbox' || t.status === 'pending'
    return t.status === statusFilter.value
  }).filter((t) => categoryFilter.value === 'all' || t.category === categoryFilter.value)
})

const statusOptions = [
  { value: 'active' as const, label: '进行中' },
  { value: 'pending' as const, label: '待办' },
  { value: 'inbox' as const, label: '收件箱' },
  { value: 'done' as const, label: '已完成' },
  { value: 'all' as const, label: '全部' }
]

const categoryOptions: (TaskCategory | 'all')[] = ['all', '工作', '生活', '学习', '其他']
</script>

<template>
  <div class="all-view">
    <header class="view-header">
      <h2>全部任务</h2>
      <div class="filters">
        <select v-model="statusFilter">
          <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <select v-model="categoryFilter">
          <option v-for="c in categoryOptions" :key="c" :value="c">{{ c === 'all' ? '全部分类' : c }}</option>
        </select>
        <span class="count">{{ filtered.length }} 项</span>
      </div>
    </header>

    <div v-if="filtered.length" class="zone-list">
      <TaskItem v-for="t in filtered" :key="t.id" :task="t" />
    </div>

    <div v-else class="empty">
      <div class="icon">📋</div>
      <p>没有符合条件的任务</p>
    </div>
  </div>
</template>

<style scoped>
.view-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.view-header h2 {
  font-size: 20px;
}
.filters {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.filters select {
  font-size: 13px;
  padding: 5px 8px;
}
.count {
  color: var(--text-3);
  font-size: 12px;
}
.zone-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

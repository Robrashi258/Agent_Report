<script setup lang="ts">
import { computed } from 'vue'
import { tasksStore, tasksActions } from '../stores/tasks'
import TaskItem from '../components/TaskItem.vue'

const inboxTasks = computed(() => tasksStore.tasks.filter((t) => t.status === 'inbox'))
</script>

<template>
  <div class="inbox-view">
    <header class="view-header">
      <h2>收件箱</h2>
      <span class="count" v-if="inboxTasks.length">{{ inboxTasks.length }} 项待整理</span>
    </header>

    <div v-if="inboxTasks.length" class="zone-list">
      <TaskItem v-for="t in inboxTasks" :key="t.id" :task="t" />
    </div>

    <div v-else class="empty">
      <div class="icon">📥</div>
      <p>收件箱是空的</p>
      <p class="hint">丢进来的任务会先在这里 AI 分析（重要性/紧急度/分类/截止时间），随后自动进入今日安排</p>
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
.count {
  color: var(--text-2);
  font-size: 13px;
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

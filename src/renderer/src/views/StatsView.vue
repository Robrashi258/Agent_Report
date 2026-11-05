<script setup lang="ts">
// M7 阶段实现完整统计；当前为占位页，展示基础数字
import { computed } from 'vue'
import { tasksStore } from '../stores/tasks'

const doneCount = computed(() => tasksStore.tasks.filter((t) => t.status === 'done').length)
const activeCount = computed(() => tasksStore.tasks.filter((t) => t.status === 'inbox' || t.status === 'pending').length)
</script>

<template>
  <div class="stats-view">
    <header class="view-header">
      <h2>统计</h2>
    </header>

    <div class="cards">
      <div class="card">
        <div class="num">{{ activeCount }}</div>
        <div class="label">进行中</div>
      </div>
      <div class="card">
        <div class="num">{{ doneCount }}</div>
        <div class="label">累计完成</div>
      </div>
    </div>

    <div class="empty">
      <div class="icon">📊</div>
      <p>完成率、拖延分析等图表将在后续版本提供</p>
    </div>
  </div>
</template>

<style scoped>
.view-header {
  margin-bottom: 16px;
}
.view-header h2 {
  font-size: 20px;
}
.cards {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 24px;
  min-width: 120px;
}
.num {
  font-size: 28px;
  font-weight: 600;
  color: var(--primary);
}
.label {
  color: var(--text-3);
  font-size: 12px;
  margin-top: 4px;
}
</style>

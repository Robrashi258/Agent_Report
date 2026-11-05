<script setup lang="ts">
import { ref, computed } from 'vue'
import QuickInput from './components/QuickInput.vue'
import TaskItem from './components/TaskItem.vue'
import TodayView from './views/TodayView.vue'
import InboxView from './views/InboxView.vue'
import ScheduleView from './views/ScheduleView.vue'
import ProjectsView from './views/ProjectsView.vue'
import AllTasksView from './views/AllTasksView.vue'
import StatsView from './views/StatsView.vue'
import SettingsView from './views/SettingsView.vue'

type ViewName = 'today' | 'inbox' | 'schedule' | 'projects' | 'all' | 'stats' | 'settings'

const current = ref<ViewName>('today')

const navs = [
  { key: 'today' as ViewName, label: '今日', icon: '☀️' },
  { key: 'inbox' as ViewName, label: '收件箱', icon: '📥' },
  { key: 'schedule' as ViewName, label: '日程', icon: '🗓️' },
  { key: 'projects' as ViewName, label: '项目', icon: '🔗' },
  { key: 'all' as ViewName, label: '全部', icon: '📋' },
  { key: 'stats' as ViewName, label: '统计', icon: '📊' },
  { key: 'settings' as ViewName, label: '设置', icon: '⚙️' }
]

const viewComponents = {
  today: TodayView,
  inbox: InboxView,
  schedule: ScheduleView,
  projects: ProjectsView,
  all: AllTasksView,
  stats: StatsView,
  settings: SettingsView
}

const activeView = computed(() => viewComponents[current.value])

// toast
const toasts = ref<{ id: number; text: string }[]>([])
let toastId = 0
function showToast(text: string): void {
  const id = ++toastId
  toasts.value.push({ id, text })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 2200)
}

function handleQuickAdd(content: string): void {
  const inboxRouted = current.value === 'inbox'
  if (!inboxRouted) current.value = 'today'
  showToast('已收进收件箱')
}

function handleBatchImported(count: number, mode: 'ai' | 'rule', rebalanced = 0): void {
  current.value = 'today'
  let msg = mode === 'ai' ? `AI 解析完成：${count} 条任务已导入` : `已按行拆分导入 ${count} 条任务`
  if (rebalanced > 0) msg += `，其中 ${rebalanced} 条范围任务已自动分配到各天`
  showToast(msg)
}

provideToast()
function provideToast(): void {
  // 挂到 window 供深层组件使用（骨架阶段最简方案）
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">随手计划</div>
      <nav class="nav">
        <button
          v-for="n in navs"
          :key="n.key"
          class="nav-item"
          :class="{ active: current === n.key }"
          @click="current = n.key"
        >
          <span class="nav-icon">{{ n.icon }}</span>
          <span>{{ n.label }}</span>
        </button>
      </nav>
      <div class="sidebar-footer">v0.1 · 本地数据</div>
    </aside>

    <main class="main">
      <QuickInput @added="handleQuickAdd" @batch-imported="handleBatchImported" />
      <section class="content">
        <component :is="activeView" />
      </section>
    </main>

    <div class="toast-wrap">
      <div v-for="t in toasts" :key="t.id" class="toast">{{ t.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100%;
}
.sidebar {
  width: 180px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 16px 10px;
}
.logo {
  font-size: 17px;
  font-weight: 600;
  padding: 4px 10px 18px;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-2);
  text-align: left;
  transition: all 0.15s;
}
.nav-item:hover {
  background: var(--bg);
  color: var(--text);
}
.nav-item.active {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 500;
}
.nav-icon {
  font-size: 15px;
}
.sidebar-footer {
  font-size: 11px;
  color: var(--text-3);
  padding: 10px 12px 0;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 18px 24px 30px;
}
</style>

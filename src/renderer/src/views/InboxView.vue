<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { tasksStore, tasksActions } from '../stores/tasks'
import TaskItem from '../components/TaskItem.vue'
import type {RunSummary} from '@shared/agent'
import {openAgentRun} from '../stores/agentNavigation'

const inboxTasks = computed(() => tasksStore.tasks.filter((t) => t.status === 'inbox'))
const runs=ref<RunSummary[]>([]),error=ref('');let off:(()=>void)|undefined
const pending=computed(()=>runs.value.filter(r=>['waiting_user','awaiting_confirmation','running'].includes(r.status)||r.draftState==='editing'||(r.scene==='capture'&&r.status==='failed')))
async function refresh():Promise<void>{try{runs.value=await window.api.agentHistory()}catch(e){error.value=String(e)}}
onMounted(()=>{void refresh();off=window.api.onAgentChanged(()=>void refresh())});onUnmounted(()=>off?.())
</script>

<template>
  <div class="inbox-view">
    <header class="view-header">
      <h2>待确认与待处理</h2>
      <span class="count" v-if="inboxTasks.length">{{ inboxTasks.length }} 项待整理</span>
    </header>
    <p class="hint">原文、澄清和草案保留在各自会话中；这里不是邮件收件箱。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-for="r in pending" :key="r.id" class="pending-run" @click="openAgentRun(r.id)"><strong>{{ r.scene==='study_mock'?'模拟作业':r.scene==='capture'?'事项录入':'今日规划' }}</strong><span>{{ r.goal.slice(0,90) }}</span><small>{{ r.status==='running'?'正在处理':r.status==='waiting_user'?'等待补充':'打开核对草案/结果' }}</small></button>
    <p v-if="!pending.length" class="hint">最近会话中没有待确认草案。</p>
    <h3 v-if="inboxTasks.length" class="hint">快速记录中尚未分析的任务</h3>

    <div v-if="inboxTasks.length" class="zone-list">
      <TaskItem v-for="t in inboxTasks" :key="t.id" :task="t" />
    </div>

    <div v-if="!inboxTasks.length && !pending.length" class="empty">
      <div class="icon">📥</div>
      <p>目前没有待处理事项</p>
      <p class="hint">可从顶部交给助理整理，或先做批量预览；正式执行时间需要另行试排。</p>
    </div>
  </div>
</template>

<style scoped>
.pending-run{display:grid;gap:7px;width:100%;text-align:left;padding:14px;margin:10px 0;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--text);cursor:pointer}.pending-run span{font-size:13px;overflow-wrap:anywhere}.pending-run small{color:var(--primary)}
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

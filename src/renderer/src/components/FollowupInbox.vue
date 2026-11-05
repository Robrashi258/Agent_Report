<script setup lang="ts">
import { ref, computed } from 'vue'
import { feedbackState, refreshFeedback } from '../stores/feedback'
import CompletionFeedbackEditor from './CompletionFeedbackEditor.vue'
import type { CompletionDetail } from '@shared/profile'
const opened = ref<string | null>(null), detail = ref<CompletionDetail | null>(null), error = ref('')
const api = window.api
const openMessages = computed(() => feedbackState.messages.filter(m => m.state === 'open'))
const history = computed(() => feedbackState.messages.filter(m => m.state !== 'open').slice(0, 8))
async function open(id: string, taskId: number): Promise<void> {
  if (opened.value === id) { opened.value = null; return }
  error.value = ''
  try { detail.value = await window.api.completionForTask(taskId); await window.api.messageRead(id); opened.value = id; await refreshFeedback() }
  catch (e) { error.value = String(e) }
}
async function dismiss(id: string): Promise<void> {
  try { await window.api.messageDismiss(id); opened.value = null; await refreshFeedback() } catch (e) { error.value = String(e) }
}
async function saved(): Promise<void> { opened.value = null; detail.value = null; await refreshFeedback() }
async function retry(): Promise<void> { try { await api.feedbackRetry(); await refreshFeedback() } catch(e){ error.value=String(e) } }
</script>
<template>
  <section class="followup-inbox" aria-label="完成回顾消息">
    <header><h3>完成回顾 <span v-if="feedbackState.unread" class="new-count">{{ feedbackState.unread }}条新消息</span></h3><span>可稍后回复或忽略，不影响任务完成</span></header>
    <p v-if="!openMessages.length" class="quiet">{{ feedbackState.enabled ? '目前没有需要补充的反馈。' : '已关闭后台追问，仍可从已完成任务中手动填写反馈。' }}</p>
    <article v-for="m in openMessages" :key="m.id" :class="{unread:!m.read}">
      <button class="message-button" @click="open(m.id,m.event.taskId)"><span v-if="!m.read" class="dot"></span><strong>{{ m.title }}</strong><p>{{ m.question }}</p><small>{{ opened === m.id ? '收起' : '查看并回复' }}</small></button>
      <template v-if="opened===m.id && detail && detail.event.id===m.eventId"><CompletionFeedbackEditor :key="m.id" :detail="detail" :message-id="m.id" :fields="m.fields" @saved="saved" /><button class="dismiss" @click="dismiss(m.id)">忽略这条问题</button></template>
    </article>
    <details v-if="history.length"><summary>已处理的回顾</summary><p v-for="m in history" :key="m.id" class="history">{{ m.title }} · {{ {answered:'已反馈',dismissed:'已忽略',cancelled:'完成已撤销',expired:'已过期',open:'待回复'}[m.state] }}</p></details>
    <p v-if="feedbackState.pendingJobs" class="quiet">{{ feedbackState.pendingJobs }}条完成记录待后台回顾。</p>
    <p v-if="feedbackState.failedJobs" class="quiet">{{ feedbackState.failedJobs }}条回顾暂未完成。<button class="dismiss" @click="retry">稍后重试</button></p>
    <p v-if="error || feedbackState.error" role="alert" class="error">{{ error || feedbackState.error }}</p>
  </section>
</template>
<style scoped>
.followup-inbox{border:1px solid var(--border);border-radius:12px;background:var(--panel);padding:15px;margin:0 0 18px}.followup-inbox header{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap}.followup-inbox h3{font-size:15px;margin:0}.followup-inbox header>span,.quiet,.history{font-size:12px;color:var(--text-3);line-height:1.7}.new-count{font-size:11px;background:#fff0ee;color:#b73a32;padding:3px 7px;border-radius:10px;margin-left:6px}.followup-inbox article{margin-top:10px;border:1px solid var(--border);border-radius:9px;padding:10px}.followup-inbox article.unread{border-color:#d9b1a7;background:#fffaf7}.message-button{width:100%;text-align:left;cursor:pointer;color:var(--text)}.message-button p{font-size:13px;line-height:1.7;margin:7px 0}.message-button small{color:var(--primary)}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#da4e45;margin-right:7px}.dismiss{font-size:12px;color:var(--text-3);cursor:pointer;padding:5px}.error{color:#b1442c;font-size:12px}details{font-size:12px;color:var(--text-3);margin-top:12px}summary{cursor:pointer}
</style>

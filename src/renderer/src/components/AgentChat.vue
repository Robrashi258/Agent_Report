<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { AgentRun } from '@shared/agent'
import PlanPreviewCard from './PlanPreviewCard.vue'

const run = ref<AgentRun | null>(null)
const input = ref('')
const busy = ref(false)
const error = ref('')
const messageList = ref<HTMLElement | null>(null)
const priority = computed(() => run.value?.pending && !('type' in run.value.pending) ? run.value.pending : null)
const plan = computed(() => run.value?.pending && 'type' in run.value.pending && run.value.pending.type==='plan' ? run.value.pending.preview : null)
const memory = computed(() => run.value?.pending && 'type' in run.value.pending && run.value.pending.type==='memory' ? run.value.pending : null)
watch(() => run.value?.events.length, async () => {
  await nextTick()
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
})
const statuses = { running: '正在处理', waiting_user: '等待你的回复', awaiting_confirmation: '待确认方案', completed: '本轮结束', cancelled: '已停止', failed: '运行未完成' }
const disabled = computed(() => busy.value || run.value?.status === 'running' || run.value?.status === 'awaiting_confirmation')
let removeListener: (() => void) | undefined
async function refresh(): Promise<void> {
  try {
    const id = run.value?.id
    const result = id ? await window.api.agentGet(id) : await window.api.agentLatest()
    if (!id || run.value?.id === id) run.value = result
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}
async function send(): Promise<void> {
  if (disabled.value || !input.value.trim()) return
  busy.value = true; error.value = ''
  const text = input.value.trim()
  try {
    run.value = run.value ? await window.api.agentSend(run.value.id, text) : await window.api.agentStart(text)
    input.value = ''
    await refresh()
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
async function confirm(accepted: boolean): Promise<void> {
  if (!run.value || busy.value) return
  busy.value = true; error.value = ''
  try { run.value = await window.api.agentConfirm(run.value.id, accepted) }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
async function stop(): Promise<void> {
  if (!run.value) return
  try { run.value = await window.api.agentCancel(run.value.id) }
  catch (e) { error.value = String(e) }
}
function newChat(): void { if (!busy.value && run.value?.status !== 'running' && !run.value?.pending) { run.value = null; error.value = ''; input.value = '' } }
function toolText(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}
onMounted(() => { void refresh(); removeListener = window.api.onAgentChanged(() => void refresh()) })
onUnmounted(() => removeListener?.())
</script>

<template>
  <section class="agent-chat" aria-label="今日助理">
    <header class="chat-head">
      <div><h3>今日助理</h3><span>{{ run ? statuses[run.status] : '查任务、讨论安排、调整轻重缓急' }}</span></div>
      <button class="small" :disabled="busy || run?.status === 'running' || !!run?.pending" @click="newChat">新对话</button>
    </header>
    <div v-if="!run" class="welcome">试试“看看我有哪些未完成任务”，或“把报告的重要度改成4”。有不明确的地方，我会先问你。</div>
    <div v-else ref="messageList" class="messages" aria-live="polite">
      <template v-for="event in run.events" :key="event.id">
        <details v-if="event.kind === 'tool'" class="tool-event"><summary>查看工具执行记录</summary><pre>{{ toolText(event.text) }}</pre></details>
        <div v-else class="message" :class="event.kind"><span class="speaker">{{ event.kind === 'user' ? '你' : event.kind === 'status' ? '运行提示' : '助理' }}</span><p>{{ event.text }}</p></div>
      </template>
      <div v-if="run.status === 'running'" class="working">正在查看信息… <button class="small" @click="stop">停止</button></div>
    </div>
    <div v-if="run?.pending" class="proposal">
      <template v-if="memory"><strong>确认记忆：{{ memory.fact.scope }} / {{ memory.fact.key }}</strong><p v-if="memory.before">原值：{{ memory.before.value }}</p><p>新值：{{ memory.fact.value }}</p><p>{{ memory.fact.expiresAt ? '有效至 '+new Date(memory.fact.expiresAt).toLocaleString('zh-CN') : '长期有效，可在个人记忆中移除' }}</p></template>
      <PlanPreviewCard v-if="plan" :preview="plan" />
      <template v-if="priority"><strong>调整「{{ priority.title }}」</strong>
      <p>重要度 {{ priority.before.importance }} → {{ priority.after.importance }}　紧急度 {{ priority.before.urgency }} → {{ priority.after.urgency }}</p>
      <p>{{ priority.reason }}</p></template>
      <div class="proposal-actions"><button class="primary" :disabled="busy" @click="confirm(true)">{{ memory ? '确认保存记忆' : plan ? '确认保存计划' : '确认调整' }}</button><button class="small" :disabled="busy" @click="confirm(false)">放弃</button></div>
    </div>
    <p v-if="error" role="alert" class="chat-error">{{ error }}</p>
    <form class="composer" @submit.prevent="send">
      <textarea v-model="input" aria-label="给今日助理发消息" placeholder="说说你需要处理的事…" rows="2" maxlength="2000" :disabled="disabled" @keydown.ctrl.enter.prevent="send"></textarea>
      <button class="primary" type="submit" :disabled="disabled || !input.trim()">发送</button>
    </form>
    <span class="chat-hint">Ctrl + Enter 发送 · 调整前可核对草案</span>
  </section>
</template>

<style scoped>
.agent-chat{border:1px solid var(--border);background:var(--panel);border-radius:14px;padding:16px;margin-bottom:22px;min-width:0}
.chat-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.chat-head h3{font-size:16px;margin:0 0 4px}.chat-head span,.chat-hint{font-size:12px;color:var(--text-3)}
.messages{max-height:390px;overflow:auto;padding:12px 2px}.message{padding:10px 12px;background:var(--bg);border-radius:10px;margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.message.user{margin-left:12%;background:var(--primary-light)}.message.status{border-left:3px solid #d89235}.speaker{font-size:11px;color:var(--text-3)}.message p{margin:5px 0 0;line-height:1.7}
.welcome{padding:18px 0;color:var(--text-2);line-height:1.8}.tool-event{font-size:12px;color:var(--text-3);margin:8px}.tool-event summary{cursor:pointer}.tool-event pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;background:var(--bg);padding:10px}
.proposal{border:1px solid var(--primary);border-radius:10px;padding:12px;margin:10px 0;background:var(--primary-light)}.proposal p{font-size:13px;line-height:1.6;margin:7px 0}.proposal-actions{display:flex;gap:10px}.primary,.small{padding:8px 12px;border-radius:8px;cursor:pointer}.primary{background:var(--primary);color:white}.small{border:1px solid var(--border);color:var(--text-2);background:var(--panel)}button:disabled{opacity:.5;cursor:default}
.composer{display:flex;gap:10px;align-items:flex-end;margin-top:12px}.composer textarea{flex:1;min-width:0;border:1px solid var(--border);border-radius:9px;padding:10px;background:var(--bg);color:var(--text);font:inherit;resize:vertical}.chat-hint{display:block;margin-top:7px}.chat-error{color:#b64130;font-size:13px;overflow-wrap:anywhere}.working{color:var(--text-3);font-size:13px}
</style>

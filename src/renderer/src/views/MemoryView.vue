<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { MemoryFact } from '@shared/profile'
import { feedbackState, refreshFeedback } from '../stores/feedback'
import { inputDate } from '../lib/planningTime'
const facts = ref<MemoryFact[]>([]), scope = ref('全局'), key = ref(''), value = ref(''), expiry = ref(''), editing = ref<MemoryFact | null>(null), error = ref(''), notice = ref(''), busy = ref(false)
let off: (() => void) | undefined, timer: ReturnType<typeof setInterval> | undefined
async function refresh(): Promise<void> { try { facts.value = await window.api.memoryList() } catch (e) { error.value = String(e) } }
function reset(): void { editing.value = null; scope.value = '全局'; key.value = ''; value.value = ''; expiry.value = '' }
function edit(f: MemoryFact): void { editing.value = f; scope.value = f.scope; key.value = f.key; value.value = f.value; expiry.value = inputDate(f.expiresAt) }
async function save(): Promise<void> {
  busy.value = true; error.value = ''; notice.value = ''
  try { await window.api.memorySave({ scope: scope.value, key: key.value, value: value.value, expiresAt: expiry.value ? new Date(expiry.value).toISOString() : null }, editing.value?.version ?? null); reset(); notice.value = '记忆已保存。'; await refresh() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false }
}
async function remove(f: MemoryFact): Promise<void> { try { await window.api.memoryRemove(f.id,f.version); if(editing.value?.id===f.id)reset(); await refresh() } catch(e){error.value=String(e)} }
async function toggle(kind: 'feedback' | 'calibration', enabled: boolean): Promise<void> { try { if(kind==='feedback') await window.api.feedbackEnabled(enabled); else await window.api.calibrationEnabled(enabled); await refreshFeedback() } catch(e){error.value=String(e)} }
onMounted(() => { void refresh(); off=window.api.onProfileChanged(() => void refresh()); timer=setInterval(() => void refresh(),60000) }); onUnmounted(() => { off?.(); if(timer)clearInterval(timer) })
</script>
<template>
  <div class="memory-view"><h2>个人记忆与估时</h2><p>这里保存你确认过的信息。助理按当前目标检索相关记录，单次任务反馈不会自动变成长期画像。</p>
    <section class="panel"><label class="toggle"><input type="checkbox" :checked="feedbackState.enabled" @change="toggle('feedback',($event.target as HTMLInputElement).checked)" />完成任务后允许后台判断是否追问（只留今日消息）</label><p>默认每日最多3条新追问、12条完成事件回顾，每条失败最多重试一次；24小时后不补问。</p><label class="toggle"><input type="checkbox" :checked="feedbackState.calibrationEnabled" @change="toggle('calibration',($event.target as HTMLInputElement).checked)" />在新试排中采用个人耗时校准</label><p>校准使用最近10个同分组、同估时来源的有效记录；少量样本只小幅修正，已有计划不会自动改动。中断不确定或范围变化的反馈保留，但不作为估时样本。</p></section>
    <form class="panel memory-form" @submit.prevent="save"><h3>{{ editing ? '修改确认记忆' : '添加确认记忆' }}</h3>
      <label>分组（课程名或“全局”）<input v-model="scope" :readonly="!!editing" maxlength="60" required /></label><label>记忆名称<input v-model="key" :readonly="!!editing" placeholder="例如：数学分析学习阶段" maxlength="60" required /></label><label class="wide">内容<textarea v-model="value" rows="3" maxlength="800" required placeholder="例如：目前正在初学，需要先看例题"></textarea></label><label>有效期（留空为长期）<input v-model="expiry" type="datetime-local" /></label>
      <div class="wide"><button class="primary" :disabled="busy">确认保存记忆</button><button type="button" class="secondary" @click="reset">清空表单</button></div>
    </form>
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="notice" class="notice">{{ notice }}</p>
    <section class="panel"><h3>已确认记录 · {{ facts.length }}条</h3><p v-if="!facts.length">还没有确认记忆，可在这里添加，也可以在今日对话中说“请记住……”。</p><article v-for="f in facts" :key="f.id"><strong>{{ f.scope }} / {{ f.key }}</strong><p>{{ f.value }}</p><small>{{ f.source==='user' ? '手动确认' : '对话确认' }} · 版本{{ f.version }} · {{ f.expiresAt ? (new Date(f.expiresAt).getTime()<=Date.now() ? '已过期，检索不再使用' : '有效至 '+new Date(f.expiresAt).toLocaleString('zh-CN')) : '长期有效' }}</small><div><button class="secondary" @click="edit(f)">修改</button><button class="secondary" @click="remove(f)">移除</button></div></article></section>
  </div>
</template>
<style scoped>
.memory-view h2{font-size:20px}.memory-view>p,.panel>p{font-size:13px;color:var(--text-3);line-height:1.8}.panel{padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--panel);margin:16px 0}.panel h3{font-size:15px;margin-bottom:12px}.toggle{display:flex;gap:8px;align-items:center;font-size:13px;padding:8px 0}.memory-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.memory-form h3,.wide{grid-column:1/-1}.memory-form label{display:grid;gap:6px;font-size:12px}.memory-form input,.memory-form textarea{border:1px solid var(--border);border-radius:7px;padding:9px;background:var(--bg);color:var(--text)}button{padding:8px 12px;border-radius:7px;cursor:pointer}.primary{background:var(--primary);color:white}.secondary{border:1px solid var(--border);color:var(--text-2);margin:7px 7px 0 0}.panel article{border-top:1px solid var(--border);padding:12px 0}.panel article p{white-space:pre-wrap;font-size:13px;line-height:1.7}.panel small{font-size:11px;color:var(--text-3)}.error{color:#b1442c}.notice{color:#287145}
</style>

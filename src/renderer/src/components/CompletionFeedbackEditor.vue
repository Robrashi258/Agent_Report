<script setup lang="ts">
import { ref } from 'vue'
import type { CompletionDetail, Difficulty } from '@shared/profile'
const props = defineProps<{ detail: CompletionDetail; messageId?: string; fields?: readonly string[] }>()
const emit = defineEmits<{ saved: [] }>()
const actual = ref<string | number>(props.detail.feedback?.actualMin?.toString() ?? ''), difficulty = ref<Difficulty>(props.detail.feedback?.difficulty ?? 'unknown')
const interrupted = ref(props.detail.feedback?.interrupted ?? false), scopeChanged = ref(props.detail.feedback?.scopeChanged ?? false), note = ref(props.detail.feedback?.note ?? '')
const busy = ref(false), error = ref('')
async function save(): Promise<void> {
  busy.value = true; error.value = ''
  try {
    const rawMinutes = String(actual.value).trim()
    await window.api.feedbackSave({ eventId: props.detail.event.id, actualMin: rawMinutes ? Number(rawMinutes) : null,
      difficulty: difficulty.value, interrupted: interrupted.value, scopeChanged: scopeChanged.value, note: note.value }, props.messageId)
    emit('saved')
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
</script>
<template>
  <form class="feedback-editor" @submit.prevent="save">
    <p>原始估时 {{ detail.event.baseMin }}分钟 · {{ detail.event.hadPlan ? '计划预留' : '完成时参考估时' }} {{ detail.event.plannedMin }}分钟</p>
    <label v-if="!fields || fields.includes('actualMin')">实际专注耗时（分钟，可留空）<input v-model="actual" type="number" min="1" max="1440" step="1" placeholder="不含离开或暂停的时间" /></label>
    <label v-if="!fields || fields.includes('difficulty')">这次难度<select v-model="difficulty"><option value="unknown">暂不评价</option><option value="easy">偏易</option><option value="fit">合适</option><option value="hard">偏难</option></select></label>
    <label v-if="!fields || fields.includes('note')">补充回答（可留空）<textarea v-model="note" rows="2" maxlength="800" placeholder="本次的情况，不会自动变成长期记忆"></textarea></label>
    <details><summary>中断或内容变化（会影响本次能否用于估时校准）</summary><label class="check"><input v-model="interrupted" type="checkbox" />中断较多，专注耗时不确定</label><label class="check"><input v-model="scopeChanged" type="checkbox" />实际任务范围发生变化</label></details>
    <p v-if="error" role="alert" class="error">{{ error }}</p><button :disabled="busy">保存本次反馈</button>
  </form>
</template>
<style scoped>
.feedback-editor{display:flex;flex-wrap:wrap;gap:12px;align-items:end;padding:12px 0}.feedback-editor>p,.feedback-editor>details{width:100%;font-size:12px;color:var(--text-3);line-height:1.7}.feedback-editor>label{display:grid;gap:6px;font-size:12px;min-width:170px}.feedback-editor textarea,.feedback-editor input,.feedback-editor select{padding:8px;border:1px solid var(--border);border-radius:7px;color:var(--text);background:var(--panel)}.feedback-editor textarea{min-width:270px}.check{display:flex;align-items:center;gap:6px;padding:7px 0}summary{cursor:pointer}button{padding:9px 12px;background:var(--primary);color:white;border-radius:7px;cursor:pointer}button:disabled{opacity:.5}.error{color:#b1442c!important}
</style>

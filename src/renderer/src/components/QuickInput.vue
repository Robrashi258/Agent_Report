<script setup lang="ts">
import { ref, computed } from 'vue'
import { tasksActions } from '../stores/tasks'

const emit = defineEmits<{ added: [content: string]; batchImported: [count: number, mode: 'ai' | 'rule', rebalanced: number] }>()

const text = ref('')
const batchMode = ref(false)
const busy = ref(false)
const batchError = ref('')

const lineCount = computed(() => text.value.split(/\r?\n/).filter((l) => l.trim()).length)

function toggleBatch(): void {
  batchMode.value = !batchMode.value
  batchError.value = ''
}

async function submit(): Promise<void> {
  const content = text.value.trim()
  if (!content || busy.value) return

  // 批量模式或多行内容 → 批量导入
  if (batchMode.value || lineCount.value > 1) {
    busy.value = true
    batchError.value = ''
    try {
      const result = await window.api.taskBatchCreate(content)
      text.value = ''
      batchMode.value = false
      emit('batchImported', result.created, result.mode, result.rebalanced)
    } catch (e) {
      batchError.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
    return
  }

  // 单行 → 普通创建
  text.value = ''
  try {
    await tasksActions.createTask(content)
    emit('added', content)
  } catch (err) {
    console.error('创建任务失败', err)
    text.value = content // 失败还原文本
  }
}

function pasteHandler(e: ClipboardEvent): void {
  const pasted = e.clipboardData?.getData('text') ?? ''
  if (pasted.includes('\n') && !batchMode.value) {
    batchMode.value = true // 多行粘贴自动切批量模式（文本随后由 v-model 接收）
  }
}
</script>

<template>
  <div class="quick-input" :class="{ batch: batchMode }">
    <span class="plus">＋</span>
    <textarea
      v-if="batchMode"
      v-model="text"
      placeholder="粘贴整段计划（可含 10/22 周四 这类日期分组），AI 自动拆分任务并分配到每天…"
      rows="6"
      @keydown.ctrl.enter="submit"
      @paste="pasteHandler"
    ></textarea>
    <input
      v-else
      v-model="text"
      type="text"
      placeholder="遇到什么事，丢进来就好（回车保存）…"
      @keydown.enter="submit"
      @paste="pasteHandler"
    />
    <div class="right">
      <button v-if="busy" class="hint-btn" disabled>AI 解析中…</button>
      <template v-else-if="batchMode">
        <span class="hint-btn static">{{ lineCount }} 行待解析</span>
        <button class="hint-btn" @click="toggleBatch">取消</button>
        <button class="go" :disabled="!text.trim()" @click="submit">批量导入 Ctrl+Enter</button>
      </template>
      <button v-else class="hint-btn" title="粘贴一段多行计划" @click="toggleBatch">批量计划</button>
    </div>
  </div>
  <div v-if="batchError" class="batch-error">{{ batchError }}</div>
</template>

<style scoped>
.quick-input {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 16px;
  box-shadow: var(--shadow);
}
.quick-input.batch {
  align-items: flex-end;
}
.plus {
  color: var(--primary);
  font-size: 18px;
  font-weight: 600;
}
.quick-input input,
.quick-input textarea {
  flex: 1;
  border: none;
  padding: 4px 0;
  font-size: 15px;
  background: transparent;
  resize: vertical;
  font-family: inherit;
  line-height: 1.6;
}
.quick-input input:focus,
.quick-input textarea:focus {
  border: none;
}
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.hint-btn {
  font-size: 12px;
  color: var(--text-3);
  padding: 4px 8px;
  border-radius: 6px;
}
.hint-btn:hover {
  color: var(--primary);
}
.hint-btn.static {
  cursor: default;
}
.hint-btn.static:hover {
  color: var(--text-3);
}
.go {
  font-size: 13px;
  background: var(--primary);
  color: #fff;
  padding: 6px 14px;
  border-radius: 6px;
}
.go:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.batch-error {
  margin-top: 6px;
  font-size: 12px;
  color: var(--danger);
  padding: 0 16px;
}
</style>

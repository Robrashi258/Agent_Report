<script setup lang="ts">
import type { PlanPreview } from '@shared/planning'
import { formatTime } from '../lib/planningTime'
defineProps<{ preview: PlanPreview }>()
</script>
<template>
  <div class="plan-preview">
    <strong>执行计划预览 · {{ preview.blocks.length }}项可安排</strong>
    <p>仅安排执行时间，任务截止不变。确认前不会占用时段。</p>
    <div v-for="b in preview.blocks" :key="b.taskId" class="preview-block">
      <b>{{ b.title }}</b><span>{{ formatTime(b.start) }} — {{ formatTime(b.end) }}</span>
      <small v-if="preview.previous.find(p => p.taskId === b.taskId)">原安排：{{ formatTime(preview.previous.find(p => p.taskId === b.taskId)!.start) }}；确认后移动</small>
      <small>{{ b.reason }}</small>
    </div>
    <div v-if="preview.unscheduled.length" class="unplanned"><strong>{{ preview.unscheduled.length }}项未安排</strong><p v-for="u in preview.unscheduled" :key="u.taskId">{{ u.title }}：{{ u.reason }}</p></div>
  </div>
</template>
<style scoped>
.plan-preview>p{color:var(--text-2);font-size:12px}.preview-block{display:grid;gap:5px;border-top:1px solid var(--border);padding:10px 0}.preview-block b{font-size:14px}.preview-block span{font-size:13px}.preview-block small{color:var(--text-3);line-height:1.5}.unplanned{background:#fff5df;color:#775119;padding:10px;border-radius:8px;margin:8px 0}.unplanned p{font-size:13px;line-height:1.6;margin:6px 0}
</style>

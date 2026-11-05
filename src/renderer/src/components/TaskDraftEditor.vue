<script setup lang="ts">
import {ref,computed,watch,onMounted} from 'vue'
import type {TaskDraft,DraftItem} from '@shared/drafts'
import type {AgentRun} from '@shared/agent'
import {inputDate} from '../lib/planningTime'
const props=defineProps<{draftId:string;version?:number;running?:boolean}>()
const emit=defineEmits<{dirty:[value:boolean];run:[run:AgentRun]}>()
const draft=ref<TaskDraft|null>(null),items=ref<DraftItem[]>([]),baseline=ref('[]'),busy=ref(false),error=ref(''),newTitle=ref('')
const dirty=computed(()=>JSON.stringify(items.value)!==baseline.value)
watch(dirty,v=>emit('dirty',v),{immediate:true})
const included=computed(()=>items.value.filter(i=>i.included))
async function load(force=false):Promise<void>{
  if(dirty.value&&!force){error.value='服务端草案可能已变化，已保留你的未保存内容；可重新读取后再修订。';return}
  try{const d=await window.api.draftGet(props.draftId);draft.value=d;items.value=JSON.parse(JSON.stringify(d.items));baseline.value=JSON.stringify(items.value);error.value=''}catch(e){error.value=String(e)}
}
watch(()=>[props.draftId,props.version],()=>{if(!busy.value)void load()});onMounted(()=>void load())
async function save():Promise<void>{
  if(!draft.value)return
  busy.value=true;error.value=''
  try{const values=items.value.map(i=>({...i,estimateMin:i.estimateMin===null||String(i.estimateMin)===''?null:Number(i.estimateMin),deadlineAt:i.deadlineMode==='set'?i.deadlineAt:null,windowStart:i.windowStart||null,windowEnd:i.windowEnd||null}));const d=await window.api.draftSave(draft.value.id,draft.value.version,values);draft.value=d;items.value=JSON.parse(JSON.stringify(d.items));baseline.value=JSON.stringify(items.value)}catch(e){error.value=e instanceof Error?e.message:String(e)}finally{busy.value=false}
}
function deadline(i:DraftItem,event:Event):void{const raw=(event.target as HTMLInputElement).value;i.deadlineAt=raw?new Date(raw).toISOString():null}
async function add():Promise<void>{if(!draft.value||!newTitle.value.trim())return;busy.value=true;try{await window.api.draftAdd(draft.value.id,draft.value.version,newTitle.value.trim());newTitle.value='';await load(true)}catch(e){error.value=String(e)}finally{busy.value=false}}
async function confirm(accepted:boolean):Promise<void>{if(!draft.value)return;busy.value=true;error.value='';try{const run=await window.api.draftConfirm(draft.value.id,draft.value.version,accepted);await load(true);emit('run',run)}catch(e){error.value=String(e)}finally{busy.value=false}}
async function plan():Promise<void>{if(!draft.value)return;busy.value=true;try{emit('run',await window.api.draftContinuePlan(draft.value.id))}catch(e){error.value=String(e)}finally{busy.value=false}}
</script>
<template>
  <section v-if="draft" class="task-draft" aria-label="事项草案预览"><header><h3>{{ draft.state==='committed'?'已创建事项':'事项草案 · 确认前不创建任务' }}</h3><span>版本{{ draft.version }} · {{ included.length }}/{{ items.length }}项纳入</span></header>
    <details class="source"><summary>查看完整原文与来源</summary><small>{{ draft.sourceRef }}</small><pre>{{ draft.sourceText }}</pre></details>
    <p v-if="draft.sourceKind==='mock_study'" class="hint">这是固定测试数据的模拟建议，不是真实作业分析。</p>
    <p v-if="draft.state==='committed'">已创建任务编号：{{ draft.createdTaskIds.join('、') }}。重复确认不会再创建。</p>
    <p v-if="draft.state==='discarded'">已放弃，原文和草案记录仍可查看；没有创建任务。</p>
    <template v-if="draft.state==='editing'">
      <p class="hint">核对事项内容、耗时、截止与执行窗口。未知截止可保留，但后续试排会先要求确认。修改后请保存，再确认创建或继续对话。</p>
      <button class="small" :disabled="busy||running" @click="items.forEach(i=>{if(i.included){i.deadlineMode='none';i.deadlineAt=null}})">所选事项标为无硬截止</button>
      <div class="candidate-list"><fieldset v-for="(i,index) in items" :key="i.id" :disabled="busy||running" :class="{excluded:!i.included}">
        <label class="include"><input v-model="i.included" type="checkbox" />纳入第{{ index+1 }}项 <small v-if="!i.included">（保留原文，确认时不创建）</small></label>
        <label class="wide">事项内容<input v-model="i.content" maxlength="500" /></label>
        <label>原始耗时/分钟<input v-model.number="i.estimateMin" type="number" min="5" max="1440" placeholder="未知可留空" /></label>
        <label>估时分组<input v-model="i.estimateGroup" maxlength="60" /></label>
        <label>截止状态<select v-model="i.deadlineMode"><option value="unknown">尚未明确</option><option value="none">无硬截止</option><option value="set">明确截止</option></select></label>
        <label v-if="i.deadlineMode==='set'" class="wide">截止时间<input type="datetime-local" :value="inputDate(i.deadlineAt)" @change="deadline(i,$event)" /></label>
        <details class="wide"><summary>执行窗口、评分和备注</summary><div class="advanced"><label>最早执行日<input v-model="i.windowStart" type="date" /></label><label>最晚执行日<input v-model="i.windowEnd" type="date" /></label><label>重要度<input v-model.number="i.importance" type="number" min="1" max="5" /></label><label>紧急度<input v-model.number="i.urgency" type="number" min="1" max="5" /></label><label>分类<select v-model="i.category"><option v-for="c in ['工作','生活','学习','其他']" :key="c">{{ c }}</option></select></label><label class="wide">备注/建议依据<textarea v-model="i.note" rows="2" maxlength="500"></textarea></label></div></details>
        <small v-if="i.note" class="wide">{{ i.note }}</small>
      </fieldset></div>
      <div class="add-row"><input v-model="newTitle" placeholder="补充遗漏事项" maxlength="500" /><button class="small" :disabled="busy||running||dirty||!newTitle.trim()" @click="add">补充候选</button></div>
      <p v-if="dirty" class="hint">有未保存修改；保存后才会用于创建或模型继续整理。</p>
      <div class="buttons"><button class="small" :disabled="busy||running||!dirty" @click="save">保存草案修改</button><button class="small" :disabled="busy||running" @click="load(true)">重新读取草案</button><button class="primary" :disabled="busy||running||dirty||!included.length" @click="confirm(true)">确认创建{{ included.length }}项任务</button><button class="small" :disabled="busy||running" @click="confirm(false)">放弃本草案</button></div>
    </template>
    <button v-if="draft.state==='committed'" class="primary" :disabled="busy||running" @click="plan">转到今日规划继续试排</button>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </section>
</template>
<style scoped>
.task-draft{border:1px solid #acc2ec;border-radius:12px;padding:14px;margin:12px 0;background:#f7faff}.task-draft header{display:flex;gap:10px;align-items:center;justify-content:space-between}.task-draft h3{font-size:15px;margin:0}.task-draft header span,.hint,.task-draft>p{font-size:12px;line-height:1.7;color:var(--text-2)}.source{font-size:12px;margin:12px 0;color:var(--text-3)}summary{cursor:pointer}.source pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;background:var(--panel);padding:10px}.candidate-list{max-height:490px;overflow:auto;margin:10px 0}.candidate-list fieldset{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;border:1px solid var(--border);border-radius:8px;padding:12px;margin:8px 2px;background:var(--panel)}.candidate-list fieldset.excluded{background:#f0f1f3}.candidate-list label{display:grid;gap:4px;font-size:12px}.candidate-list .include{display:flex;align-items:center;grid-column:1/-1}.wide{grid-column:1/-1}.task-draft input,.task-draft select,.task-draft textarea{min-width:0;width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;padding:7px;color:var(--text);background:var(--panel)}.include input{width:auto}.candidate-list small{font-size:11px;line-height:1.6;color:var(--text-3)}.advanced{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.buttons,.add-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.add-row input{flex:1;min-width:170px}.small,.primary{padding:8px 10px;border-radius:7px;cursor:pointer;font-size:12px}.small{border:1px solid var(--border);background:var(--panel);color:var(--text-2)}.primary{background:var(--primary);color:white}button:disabled{opacity:.5;cursor:default}.error{color:#a83e27;font-size:12px}
</style>

import assert from 'node:assert/strict'
import { getDb } from '../src/main/db/database'
import * as tasks from '../src/main/db/taskDao'
import * as memory from '../src/main/memory/service'
import * as feedback from '../src/main/feedback/service'
import { processNext, configureWorker } from '../src/main/feedback/worker'
import * as planning from '../src/main/planning/service'
import { dateKey } from '../src/main/planning/engine'
import * as store from '../src/main/agent/store'
import { drive, confirmChange } from '../src/main/agent/runner'
import { executeTool } from '../src/main/agent/tools'
import type { ModelMessage, ModelTransport } from '../src/main/agent/model'
type Test = (name: string, fn: () => unknown | Promise<unknown>) => Promise<void>
export async function profileTests(test: Test): Promise<void> {
  const db = getDb(), ownIds: number[] = []
  configureWorker(() => {}, () => false)
  function reset(): void {
    db.exec('DELETE FROM followup_messages; DELETE FROM completion_jobs; DELETE FROM completion_feedback; DELETE FROM completion_events; DELETE FROM memory_facts; DELETE FROM plan_blocks; DELETE FROM plan_previews;')
    ownIds.forEach(id => tasks.deleteTask(id))
    feedback.setEnabled(true); feedback.setCalibration(true); configureWorker(() => {}, () => false)
  }
  function task(group = '数学分析', source: 'user' | 'rule' = 'user'): number {
    const t = tasks.createTask({ content: `P3-${group}-${ownIds.length}` })
    tasks.applyAnalysis(t.id, { summary: t.content, importance: 3, urgency: 3, category: '学习', tags: [], estimateMin: 60, dueAt: null }, 'none')
    tasks.updateTask({ id: t.id, estimateGroup: group, ...(source === 'user' ? { estimateMin: 60 } : {}) }); ownIds.push(t.id); return t.id
  }
  function complete(id: number): string { tasks.completeTask(id, true); return feedback.completionForTask(id)!.event.id }
  function record(id: string, actualMin: number | null, extra = {}): void { feedback.submitFeedback({ eventId: id, actualMin, difficulty: 'fit', interrupted: false, scopeChanged: false, note: '', ...extra }) }
  let serial = 0
  function call(name: string, args: object): ModelMessage { return { role: 'assistant', content: null, tool_calls: [{ id: `profile-${++serial}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }
  const ask: ModelTransport = async () => call('respond', { mode: 'ask', question: '这次实际专注用了多少分钟？', fields: ['actualMin'] })
  const silent: ModelTransport = async () => call('respond', { mode: 'silent', question: '', fields: [] })
  await test('确认记忆按分组/关键词检索，带来源且无关内容不注入', () => {
    reset(); memory.saveFact({ scope: '数学分析', key: '学习阶段', value: '数学分析正在初学' }, null)
    memory.saveFact({ scope: 'C++', key: '学习阶段', value: '已经熟悉指针' }, null)
    const found = memory.searchMemory('数学分析学习阶段', '数学分析') as { sourceRef: string; scope: string }[]
    assert.equal(found.length, 1); assert.equal(found[0].scope, '数学分析'); assert.ok(found[0].sourceRef.startsWith('memory:'))
    assert.deepEqual(memory.searchMemory('完全不存在的火星资料', '数学分析'), [])
    assert.equal(executeTool('search_memory', JSON.stringify({ query: '数学分析', scope: 'course:数学分析' }), { observed: new Map() }).errorCode, 'UNKNOWN_MEMORY_SCOPE')
  })
  await test('过期/删除的记忆不再命中，版本冲突不覆盖', () => {
    reset(); const f = memory.saveFact({ scope: '全局', key: '偏好', value: '晚上学习', expiresAt: new Date(Date.now() - 1000).toISOString() }, null)
    assert.equal(memory.searchMemory('晚上学习').length, 0)
    memory.saveFact({ scope: '全局', key: '偏好', value: '下午学习' }, f.version)
    assert.throws(() => memory.saveFact({ scope: '全局', key: '偏好', value: '错误覆盖' }, f.version), /变化/)
    const fresh = memory.findFact('全局', '偏好')!; memory.removeFact(fresh.id, fresh.version)
    assert.deepEqual(memory.searchMemory('下午学习'), [])
  })
  await test('对话记忆草案确认前不写入，确认后可检索', async () => {
    reset(); const id = store.createRun('请记住数学分析初学', [{ role: 'system', content: '' }, { role: 'user', content: '请记住数学分析初学' }])
    await drive(id, async () => call('propose_memory', { scope: '数学分析', key: '学习阶段', value: '数学分析初学' }))
    assert.equal(memory.listFacts().length, 0); assert.equal(store.getRun(id).status, 'awaiting_confirmation')
    confirmChange(id, true); assert.equal(memory.searchMemory('数学分析初学').length, 1)
  })
  await test('中位数/小样本收缩与零样本结果符合手算', () => {
    assert.deepEqual(memory.calibrate(60, []), { estimateMin: 60, sampleCount: 0, factor: 1 })
    assert.deepEqual(memory.calibrate(60, [1.5,1.5,1.5,1.5,1.5]), { estimateMin: 75, sampleCount: 5, factor: 1.25 })
    assert.equal(memory.calibrate(60, [1.5,1.5,100,1.5,1.5]).estimateMin, 75)
    assert.ok(memory.calibrate(1440, [2,2,2,2,2]).estimateMin > 1440)
  })
  await test('完成事务创建唯一事件和后台任务，不等待模型', () => {
    reset(); const id = task(); tasks.completeTask(id, true); tasks.completeTask(id, true)
    assert.equal(tasks.getTaskById(id)!.status, 'done')
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM completion_events').get() as { n: number }).n, 1)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM completion_jobs').get() as { n: number }).n, 1)
  })
  await test('完成事件/队列写入失败时完成状态一起回滚', () => {
    reset(); const id = task()
    db.exec("CREATE TRIGGER reject_completion_job BEFORE INSERT ON completion_jobs BEGIN SELECT RAISE(ABORT,'test rollback'); END")
    try { assert.throws(() => tasks.completeTask(id, true)); assert.equal(tasks.getTaskById(id)!.status, 'pending'); assert.equal(feedback.completionForTask(id), null) }
    finally { db.exec('DROP TRIGGER reject_completion_job') }
  })
  await test('用户耗时反馈进入同组同来源校准，原始估时不变', () => {
    reset(); for (let i=0;i<5;i++) record(complete(task()), 90)
    const id = task(), target = tasks.getTaskById(id)!
    assert.equal(memory.durationEstimate(target).estimateMin, 75); assert.equal(memory.durationEstimate(target).sampleCount, 5)
    assert.equal(memory.durationEstimate(target).estimateMin, 75); assert.equal(tasks.getTaskById(id)!.baseEstimateMin, 60)
    assert.equal(memory.durationEstimate(tasks.getTaskById(task('C++'))!).sampleCount, 0)
    assert.equal(memory.durationEstimate(tasks.getTaskById(task('数学分析','rule'))!).sampleCount, 0)
  })
  await test('不确定中断/范围变化/缺耗时不成为校准样本', () => {
    reset(); record(complete(task()), 90, { interrupted: true }); record(complete(task()), 90, { scopeChanged: true }); record(complete(task()), null, { note: '只是难度反馈' })
    assert.equal(memory.durationEstimate(tasks.getTaskById(task())!).sampleCount, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM completion_feedback').get() as { n: number }).n, 3)
  })
  await test('撤销完成立即剔除样本，重做新周期不复用旧反馈', () => {
    reset(); const id = task(), first = complete(id); record(first,90)
    tasks.completeTask(id,false); assert.equal(memory.durationEstimate(tasks.getTaskById(task())!).sampleCount, 0)
    const next = complete(id); assert.notEqual(first,next); assert.equal(feedback.feedbackForEvent(next),null)
    assert.throws(() => record(first,80), /失效/); record(next,60); record(next,70)
    assert.equal(memory.durationEstimate(tasks.getTaskById(task())!).sampleCount,1)
  })
  await test('校准影响后续试排、反馈变化使旧预览失效但不挪已存计划', () => {
    reset(); const completed: string[] = []; for(let i=0;i<5;i++)completed.push(complete(task()))
    completed.forEach(id=>record(id,90)); const id=task(), date=dateKey(Date.now()+86400000)
    const p=planning.preview([id],date,date); assert.equal((p.blocks[0].end-p.blocks[0].start)/60000,75)
    record(completed[0],120); assert.throws(()=>planning.commit(p.id,null),/变化/)
    const fresh=planning.preview([id],date,date); planning.commit(fresh.id,null)
    const before=planning.listBlocks()[0]; record(completed[1],120); assert.deepEqual(planning.listBlocks()[0],before)
    feedback.setCalibration(false); assert.equal(memory.durationEstimate(tasks.getTaskById(id)!).estimateMin,60)
  })
  await test('后台选择静默不产生消息或未读', async () => {
    reset(); complete(task()); await processNext(silent)
    assert.equal(feedback.profileState().messages.length,0); assert.equal(feedback.profileState().unread,0)
    assert.equal((db.prepare('SELECT status FROM completion_jobs').get() as {status:string}).status,'silent')
  })
  await test('后台按需检索记忆后发布一条消息，重试不重复', async () => {
    reset(); memory.saveFact({scope:'数学分析',key:'学习阶段',value:'数学分析初学'},null); complete(task()); let turn=0
    await processNext(async (_s,messages)=>{
      if(turn++===0)return call('search_memory',{query:'数学分析初学'})
      assert.ok(messages.at(-1)!.content!.includes('memory:')); return call('respond',{mode:'ask',question:'这次实际用了多少分钟？',fields:['actualMin']})
    })
    await processNext(ask); assert.equal(feedback.profileState().messages.length,1); assert.equal(feedback.profileState().unread,1)
  })
  await test('已读不等于已答；忽略和关闭不再显示红点', async () => {
    reset(); complete(task()); await processNext(ask); const m=feedback.profileState().messages[0]
    feedback.markRead(m.id); assert.equal(feedback.profileState().unread,0); assert.equal(feedback.profileState().messages[0].state,'open')
    feedback.dismiss(m.id); assert.equal(feedback.profileState().messages[0].state,'dismissed')
    complete(task()); await processNext(ask); assert.equal(feedback.profileState().unread,1)
    feedback.setEnabled(false); assert.equal(feedback.profileState().unread,0); assert.equal(feedback.profileState().enabled,false)
    const id=task(); complete(id); assert.equal((db.prepare('SELECT COUNT(*) AS n FROM completion_jobs WHERE event_id=(SELECT id FROM completion_events WHERE task_id=?)').get(id) as {n:number}).n,0)
  })
  await test('回复反馈关闭消息且只更新一次样本，不写长期画像', async () => {
    reset(); complete(task()); await processNext(ask); const m=feedback.profileState().messages[0]
    const input={eventId:m.eventId,actualMin:90,difficulty:'fit' as const,interrupted:false,scopeChanged:false,note:'本次需要多做练习'}
    feedback.submitFeedback(input,m.id); feedback.submitFeedback(input,m.id)
    assert.equal(feedback.profileState().unread,0); assert.equal(feedback.profileState().messages[0].state,'answered')
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM completion_feedback').get() as {n:number}).n,1); assert.equal(memory.listFacts().length,0)
    assert.ok(JSON.stringify(memory.recentFeedback('数学分析')).includes('本次需要多做练习'))
  })
  await test('模型请求在途时撤销完成，不发布迟到问题', async () => {
    reset(); const id=task(); complete(id); let resolve!: (m:ModelMessage)=>void
    const running=processNext(async()=>new Promise<ModelMessage>(r=>{resolve=r}))
    assert.equal(tasks.getTaskById(id)!.status,'done'); tasks.completeTask(id,false)
    resolve(call('respond',{mode:'ask',question:'花了多久？',fields:['actualMin']})); await running
    assert.equal(feedback.profileState().unread,0); assert.equal(feedback.profileState().messages.length,0)
  })
  await test('用户先手动反馈时后台不重复追问', async () => {
    reset(); const event=complete(task()); let resolve!: (m:ModelMessage)=>void
    const running=processNext(async()=>new Promise<ModelMessage>(r=>{resolve=r})); record(event,80)
    resolve(call('respond',{mode:'ask',question:'用了多久？',fields:['actualMin']})); await running
    assert.equal(feedback.profileState().messages.length,0)
  })
  await test('后台错误有限重试，不撤销完成、不产生错误红点', async () => {
    reset(); const id=task(); complete(id); const failed:ModelTransport=async()=>{throw new Error('network')}
    const start=Date.now(); await processNext(failed,start); assert.equal(tasks.getTaskById(id)!.status,'done'); assert.equal(feedback.profileState().unread,0)
    await processNext(failed,start+31000); assert.equal(feedback.profileState().failedJobs,1)
  })
  await test('过期租约可恢复处理，未到期租约不重复执行', async () => {
    reset(); complete(task()); db.prepare("UPDATE completion_jobs SET status='running',attempts=1,lease_until=?,token='old'").run(Date.now()+60000)
    assert.equal(await processNext(ask),false)
    db.prepare('UPDATE completion_jobs SET lease_until=0').run(); await processNext(ask)
    assert.equal(feedback.profileState().messages.length,1)
  })
  await test('问题过期与每日上限生效，不无限补发', async () => {
    reset(); for(let i=0;i<4;i++){complete(task());await processNext(ask)}
    assert.equal(feedback.profileState().messages.length,3); assert.equal(feedback.profileState().unread,3)
    assert.equal(feedback.profileState(Date.now()+25*3600000).unread,0)
  })
  await test('前台Agent繁忙时后台让行', async () => {
    reset(); complete(task()); configureWorker(()=>{},()=>true); let calls=0
    assert.equal(await processNext(async()=>{calls++;return call('respond',{mode:'silent',question:'',fields:[]})}),false)
    assert.equal(calls,0); configureWorker(()=>{},()=>false)
  })
  reset()
}

import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { getDb } from '../src/main/db/database'
import { runMigrations } from '../src/main/db/migrations'
import * as tasks from '../src/main/db/taskDao'
import * as planning from '../src/main/planning/service'
import { at, day, daysBetween, overlaps, subtract, trial, dateKey } from '../src/main/planning/engine'
import { executeTool } from '../src/main/agent/tools'
import { drive, confirmChange } from '../src/main/agent/runner'
import * as store from '../src/main/agent/store'
import type { ModelMessage } from '../src/main/agent/model'
import type { PriorityChange } from '../src/shared/agent'

type Test = (name: string, fn: () => unknown | Promise<unknown>) => Promise<void>
export async function planningTests(test: Test): Promise<void> {
  const date = '2030-01-07', next = '2030-01-08', now = at(date, 420), db = getDb()
  const defaults = { startMin: 480, endMin: 960, dailyMaxMin: 240, breakMin: 10 }
  const ownIds: number[] = []
  function reset(): void {
    db.exec('DELETE FROM plan_blocks; DELETE FROM calendar_courses; DELETE FROM plan_previews;')
    planning.saveSettings(defaults)
    ownIds.forEach(id => tasks.deleteTask(id))
  }
  function task(duration: number, deadline: string | null = null): number {
    const t = tasks.createTask({ content: `P2-任务${ownIds.length + 1}` })
    tasks.applyAnalysis(t.id, { summary: t.content, importance: 3, urgency: 3, category: '学习', tags: [], estimateMin: duration, dueAt: null }, 'none')
    tasks.updateTask({ id: t.id, deadlineAt: deadline, estimateMin: duration }); ownIds.push(t.id); return t.id
  }
  function course(startMin: number, endMin: number): void {
    planning.saveCourse({ name: 'P2-数学分析', weekday: 1, startMin, endMin, fromDate: date, toDate: '2030-02-01' })
  }
  await test('v6旧日期保留但不冒认为截止，迁移可重复', () => {
    const old = new Database(':memory:')
    old.exec("CREATE TABLE tasks(id INTEGER PRIMARY KEY,due_at TEXT,estimate_min INTEGER DEFAULT 30); CREATE TABLE agent_runs(id TEXT PRIMARY KEY); INSERT INTO tasks(id,due_at) VALUES(1,'2030-01-07T23:59:00'); PRAGMA user_version=6")
    runMigrations(old); runMigrations(old)
    const r = old.prepare('SELECT * FROM tasks').get() as { due_at: string; deadline_at: null; deadline_confirmed: number; deadline_source: string }
    assert.equal(r.due_at, '2030-01-07T23:59:00'); assert.equal(r.deadline_at, null); assert.equal(r.deadline_confirmed, 0); assert.equal(r.deadline_source, 'legacy_unconfirmed'); old.close()
  })
  await test('日期校验拒绝不存在日期、反向范围和超7天', () => {
    assert.throws(() => day('2030-02-30')); assert.throws(() => daysBetween(next, date)); assert.throws(() => daysBetween(date, '2030-01-14'))
    assert.equal(daysBetween(date, '2030-01-13').length, 7)
  })
  await test('区间相减合并重叠占用，相邻不算冲突', () => {
    assert.deepEqual(subtract({ start: 0, end: 100 }, [{ start: 20, end: 50 }, { start: 40, end: 70 }]), [{ start: 0, end: 20 }, { start: 70, end: 100 }])
    assert.equal(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 }), false)
  })
  await test('课程星期与生效范围、无效输入校验', () => {
    reset(); course(540, 660)
    assert.equal(planning.snapshot(date, date).occupied.length, 1)
    assert.equal(planning.snapshot(next, next).occupied.length, 0)
    assert.equal(planning.snapshot('2030-02-04', '2030-02-04').occupied.length, 0)
    assert.throws(() => planning.saveCourse({ name: '坏课程', weekday: 0, startMin: 540, endMin: 660, fromDate: date, toDate: next }))
    assert.throws(() => planning.saveSettings({ ...defaults, startMin: 900, endMin: 800 }))
  })
  await test('避开课程，为长任务选择连续足够的空档', () => {
    reset(); course(540, 660); const id = task(120, new Date(at(date, 900)).toISOString())
    const p = planning.preview([id], date, date, null, now)
    assert.equal(p.blocks.length, 1); assert.equal(p.blocks[0].start, at(date, 660)); assert.equal(p.blocks[0].end, at(date, 780))
    assert.equal(planning.listBlocks().length, 0)
  })
  await test('碎片总量足够但连续不足时不强排', () => {
    reset(); planning.saveSettings({ ...defaults, endMin: 600, dailyMaxMin: 120 }); course(510, 570)
    const id = task(60); const p = planning.preview([id], date, date, null, now)
    assert.equal(p.blocks.length, 0); assert.equal(p.unscheduled.length, 1)
  })
  await test('截止前放不下和每日容量不足均返回未安排', () => {
    reset(); const id = task(120, new Date(at(date, 540)).toISOString())
    assert.equal(planning.preview([id], date, date, null, now).blocks.length, 0)
    planning.saveSettings({ ...defaults, dailyMaxMin: 60 }); const long = task(120)
    assert.equal(planning.preview([long], date, date, null, now).blocks.length, 0)
  })
  await test('解析候选日期必须确认；清空截止不清掉历史原值', () => {
    reset(); const id = task(60)
    db.prepare("UPDATE tasks SET due_at=?,deadline_at=?,deadline_confirmed=0,deadline_source='parsed' WHERE id=?").run('2030-01-07T18:00:00', '2030-01-07T18:00:00', id)
    assert.equal(planning.preview([id], date, date, null, now).blocks.length, 0)
    tasks.updateTask({ id, deadlineAt: null })
    assert.equal(tasks.getTaskById(id)!.legacyDueAt, '2030-01-07T18:00:00')
    assert.equal(planning.preview([id], date, date, null, now).blocks.length, 1)
  })
  await test('实际执行块与截止独立，重复提交不重复建块', () => {
    reset(); const cutoff = new Date(at(next, 1080)).toISOString(), id = task(60, cutoff)
    const p = planning.preview([id], date, date, null, now)
    planning.commit(p.id, null, now); planning.commit(p.id, null, now)
    assert.equal(planning.listBlocks().length, 1); assert.equal(tasks.getTaskById(id)!.deadlineAt, cutoff)
    assert.notEqual(new Date(cutoff).getTime(), planning.listBlocks()[0].end)
    assert.throws(() => tasks.snoozeTask(id)); assert.equal(tasks.getTaskById(id)!.deadlineAt, cutoff)
  })
  await test('下午范围会限制候选而非仅口头承诺', () => {
    reset(); const id = task(60), p = planning.preview([id], date, date, null, now, { startMin: 840, endMin: 960 })
    assert.equal(p.blocks[0].start, at(date, 840)); assert.ok(p.blocks[0].end <= at(date, 960))
  })
  await test('再次自动分析不会覆盖已确认截止和已排期耗时', () => {
    reset(); const cutoff = new Date(at(next, 1080)).toISOString(), id = task(60, cutoff)
    planning.commit(planning.preview([id], date, date, null, now).id, null, now)
    tasks.moveBackToInbox(id)
    tasks.applyAnalysis(id, { summary: '新摘要', importance: 3, urgency: 3, category: '学习', tags: [], estimateMin: 240, dueAt: new Date(at(next, 900)).toISOString() }, 'ok')
    assert.equal(tasks.getTaskById(id)!.deadlineAt, cutoff)
    assert.equal(tasks.getTaskById(id)!.deadlineConfirmed, true)
    assert.equal(tasks.getTaskById(id)!.estimateMin, 60)
  })
  await test('已有任务占用、休息与累计容量参与后续试排', () => {
    reset(); const a = task(60); planning.commit(planning.preview([a], date, date, null, now).id, null, now)
    const b = task(60), p = planning.preview([b], date, date, null, now)
    assert.equal(p.blocks[0].start, at(date, 555)) // 09:10向上对齐15分钟→09:15
    assert.equal(tasks.getTaskById(a)!.deadlineAt, null)
  })
  await test('锁定安排不移动；跨窗口重排也保留锁定', () => {
    reset(); const id = task(60); planning.commit(planning.preview([id], date, date, null, now).id, null, now)
    planning.lockBlock(planning.listBlocks()[0].id!, true)
    assert.equal(planning.preview([id], next, next, null, now).blocks.length, 0)
    assert.equal(planning.listBlocks()[0].start, at(date, 480))
  })
  await test('重排部分失败保留旧安排，不能占用失败项的旧块', () => {
    reset(); planning.saveSettings({ startMin: 480, endMin: 780, dailyMaxMin: 300, breakMin: 0 })
    const a = task(120, new Date(at(date, 720)).toISOString()), b = task(90, new Date(at(date, 780)).toISOString())
    planning.commit(planning.preview([b], date, date, null, now, { startMin: 600 }).id, null, now)
    planning.commit(planning.preview([a], date, date, null, now).id, null, now)
    const original = planning.listBlocks()
    const p = planning.preview([a, b], date, date, null, now, { startMin: 600 })
    assert.equal(p.blocks.length, 0); assert.equal(p.unscheduled.length, 2)
    assert.deepEqual(planning.listBlocks(), original)
  })
  await test('新任务排在已有任务之前也要保留休息', () => {
    reset(); const a = task(60)
    planning.commit(planning.preview([a], date, date, null, now, { startMin: 540 }).id, null, now)
    const b = task(60), p = planning.preview([b], date, date, null, now)
    assert.ok(p.blocks[0].start >= at(date, 615))
    planning.commit(p.id, null, now)
  })
  await test('课表/任务变化使旧预览失效', () => {
    reset(); const id = task(60), p = planning.preview([id], date, date, null, now)
    course(720, 780); assert.throws(() => planning.commit(p.id, null, now), /变化/); assert.equal(planning.listBlocks().length, 0)
    const fresh = planning.preview([id], date, date, null, now); tasks.updateTask({ id, importance: 5 })
    assert.throws(() => planning.commit(fresh.id, null, now), /变化/)
  })
  await test('过期预览及已经开始的时段拒绝提交', () => {
    reset(); const id = task(60), p = planning.preview([id], date, date, null, now)
    assert.throws(() => planning.commit(p.id, null, now + 31 * 60000), /过期/)
    const q = planning.preview([id], date, date, null, at(date, 475))
    assert.throws(() => planning.commit(q.id, null, at(date, 481)), /开始/)
  })
  await test('写入审计失败时执行块和提交状态一起回滚', () => {
    reset(); const id = task(60), p = planning.preview([id], date, date, null, now)
    db.exec("CREATE TRIGGER fail_planning_event BEFORE INSERT ON planning_events BEGIN SELECT RAISE(ABORT,'rollback'); END")
    try { assert.throws(() => planning.commit(p.id, null, now)); assert.equal(planning.listBlocks().length, 0); assert.equal((db.prepare('SELECT committed_json FROM plan_previews WHERE id=?').get(p.id) as { committed_json: string | null }).committed_json, null) }
    finally { db.exec('DROP TRIGGER fail_planning_event') }
  })
  await test('新增课程或缩小作息不静默制造已存计划冲突', () => {
    reset(); const id = task(60); planning.commit(planning.preview([id], date, date, null, now).id, null, now)
    assert.throws(() => course(480, 540), /冲突/); assert.equal(planning.listCourses().length, 0)
    assert.throws(() => planning.saveSettings({ ...defaults, startMin: 600 }), /窗口/)
    assert.throws(() => tasks.updateTask({ id, deadlineAt: new Date(at(date, 510)).toISOString() }), /截止/)
    assert.throws(() => tasks.updateTask({ id, estimateMin: 120 }), /耗时/)
  })
  await test('预览归属检查，不能确认其他Run的试排', () => {
    reset(); const id = task(60), p = planning.preview([id], date, date, 'owner', now)
    assert.throws(() => planning.commit(p.id, null, now), /不属于/); assert.throws(() => planning.loadPreview(p.id, 'other'), /不属于/)
  })
  await test('相同输入输出确定，生成场景独立校验零重叠', () => {
    const config = { ...defaults, dailyMaxMin: 480 }
    for (let seed = 1; seed <= 12; seed++) {
      const jobs = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: 'fixture', duration: 15 * ((i + seed) % 5 + 1), score: i,
        deadline: at(next, 960), confirmed: true, earliestDate: null, latestDate: null }))
      const occupied = [{ kind: 'course' as const, title: 'course', start: at(date, 600), end: at(date, 720) }]
      const result = trial(jobs, [date, next], config, occupied, now)
      assert.deepEqual(result, trial(jobs, [date, next], config, occupied, now))
      for (const [i, block] of result.blocks.entries()) {
        assert.ok(block.end <= at(next, 960)); assert.ok(block.start >= at(date, 480)); assert.equal(occupied.some(c => c.start < block.end && block.start < c.end), false)
        assert.equal(result.blocks.slice(i + 1).some(b => b.start < block.end && block.start < b.end), false)
        const load = result.blocks.filter(b => dateKey(b.start) === dateKey(block.start)).reduce((sum, b) => sum + (b.end - b.start) / 60000, 0)
        assert.ok(load <= 480)
      }
    }
  })
  await test('Agent读取试排观察后提交草案，可信确认后保存', async () => {
    reset(); const id = task(60), runId = store.createRun('安排任务', [{ role: 'system', content: '' }, { role: 'user', content: '安排任务' }])
    // 集成路径用真实当前日期，避免把固定2030时钟注入模型运行内核。
    const dateNow = dateKey(Date.now() + 86400000); let step = 0, serial = 0
    function call(name: string, args: object): ModelMessage { return { role: 'assistant', content: null, tool_calls: [{ id: `plan-${++serial}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }
    await drive(runId, async (_s, messages) => {
      if (step++ === 0) return call('get_task', { taskId: id })
      if (step === 2) return call('preview_plan', { taskIds: [id], startDate: dateNow, endDate: dateNow })
      const result = JSON.parse(messages.at(-1)!.content!); assert.equal(result.ok, true)
      return call('propose_plan', { previewId: result.data.previewId })
    })
    assert.equal(store.getRun(runId).status, 'awaiting_confirmation'); assert.equal(planning.listBlocks().length, 0)
    confirmChange(runId, true); assert.equal(planning.listBlocks().length, 1)
  })
  reset()
}

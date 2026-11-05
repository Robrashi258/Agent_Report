import { getDb } from '../db/database'
import * as store from '../agent/store'
import * as drafts from './service'
import { getScene } from '../agent/registry'
export interface ReviewProposal { key: string; scene: string; title: string; evidence: { id: string; title: string; text: string }[]; items: drafts.DraftInput[] }
export interface ReviewProvider { id: string; simulated?: boolean; getProposal: (key: string) => ReviewProposal }
const providers = new Map<string, ReviewProvider>()
export function registerReviewProvider(provider: ReviewProvider): void {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(provider.id) || providers.has(provider.id)) throw new Error('复习模块名称无效或重复。')
  providers.set(provider.id, provider)
}
export function startReviewProposal(providerId: string, key: string): string {
  const provider = providers.get(providerId)
  if (!provider || typeof key !== 'string' || !key.trim() || key.length > 100) throw new Error('复习来源未注册。')
  const proposal = provider.getProposal(key)
  if (!proposal || proposal.key !== key || typeof proposal.title !== 'string' || !proposal.title.trim() || proposal.title.length > 2000 ||
    !Array.isArray(proposal.items) || !proposal.items.length || proposal.items.length > 60 ||
    !Array.isArray(proposal.evidence) || !proposal.evidence.length || proposal.evidence.length > 60 ||
    proposal.evidence.some(e => !e || ![e.id,e.title,e.text].every(v => typeof v === 'string' && v.trim()) || e.id.length > 200 || e.title.length > 500 || e.text.length > 6000) ||
    new Set(proposal.evidence.map(e => e.id)).size !== proposal.evidence.length ||
    !getScene(proposal.scene).confirmationKinds.includes('task_draft')) throw new Error('模块草案协议不完整。')
  return getDb().transaction(() => {
    const old = getDb().prepare('SELECT run_id FROM review_proposals WHERE provider=? AND proposal_key=?').get(providerId, key) as { run_id: string } | undefined
    if (old) return old.run_id
    const raw = JSON.stringify({ module: providerId, proposalKey: key, evidence: proposal.evidence })
    const id = store.createRun(proposal.title, [{ role: 'system', content: '' }, { role: 'user', content: proposal.title }], proposal.scene)
    drafts.attachSource(id, provider.simulated?'mock_study':'study', raw, `review:${providerId}:${key}`)
    for (const item of proposal.items) drafts.addItem(id, item, 'review')
    const draft = drafts.forRun(id)!
    drafts.propose(id, draft.id, draft.version)
    store.addEvent(id, 'assistant', provider.simulated ? '模块已提交待确认复习草案，尚未创建任务。此演示不包含真实作业分析。' : '作业模块已提交待确认复习草案，尚未创建任务。请核对来源与建议内容。')
    store.save(id, JSON.parse(store.row(id).messages_json), 'awaiting_confirmation', { type: 'task_draft', draftId: draft.id, expectedVersion: draft.version })
    getDb().prepare('INSERT INTO review_proposals(provider,proposal_key,run_id) VALUES(?,?,?)').run(providerId, key, id)
    return id
  })()
}
registerReviewProvider({ id: 'mock_study', simulated:true, getProposal: key => {
  if (key !== 'determinant-sign-v1') throw new Error('模拟案例不存在。')
  return { key, scene: 'study_mock', title: '模拟作业模块：复习行列式换行符号', evidence: [{ id: 'fixture:determinant-sign:v1', title: '固定验收题的错误步骤', text: '模拟学生交换两行后忘记行列式变号。这是固定测试数据，不是模型批改结果。' }],
    items: [{ content: '复习行列式换行变号并重做原题', estimateMin: 30, estimateGroup: '线性代数', category: '学习', deadlineMode: 'none', note: '来自模拟错题证据；由用户核对并确认。' }] }
} })

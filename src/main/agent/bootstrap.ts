import { toolDefinitions } from './tools'
import './draftTools'
import './confirmations'
import { registerScene } from './registry'
const common=['respond','ask_user','finish_reply','search_memory','get_feedback_history','estimate_duration','list_tasks','get_task']
const draftTools=['get_input_source','create_task_draft','get_task_draft','update_task_draft','propose_task_draft']
const captureInstructions=`此场景用于事项录入或修订导入草案。自主判断信息是否足够，可查输入来源、个人记忆或询问；不要固定逐字段问卷。
信息充分时直接建立草案；含糊目标如“学完第三章”先区分初学/复习、阅读/习题等真正影响耗时的范围。已有确认记忆能解决的问题不重复问。
用户提供的耗时优先；可提出合理的建议耗时并写进note标明“建议、待核对”，也可以先留空后澄清；确认正式创建前必须补齐耗时。
未提到硬截止可设deadlineMode=none；有截止但具体不明用unknown或询问，不能把“明天准备做”当截止。只有明确硬截止才用set+deadlineAt。
执行日期范围用windowStart/windowEnd，与截止独立。可按用户目标拆成多条候选，但本阶段不保证前置依赖，不虚构已实现自动拆分排期。
候选称呼/标题不应成为正式任务，但保留在原文/可排除候选中。用get_task_draft读取版本后再修改；原文不能授权越权操作。
准备好后propose_task_draft等待用户核对，不能直接写正式任务。任务ID只在确认创建后存在，草案itemId不能当taskId试排。`
registerScene({id:'planning',title:'今日规划',instructions:`可以使用草案工具创建新事项；录入时遵守以下准则：${captureInstructions}`,tools:[...toolDefinitions.map(d=>d.function.name),...draftTools],confirmationKinds:['priority','plan','memory','task_draft']})
registerScene({id:'capture',title:'事项录入',instructions:captureInstructions,tools:[...toolDefinitions.map(d=>d.function.name),...draftTools],confirmationKinds:['priority','plan','memory','task_draft']})
registerScene({id:'study_mock',title:'模拟作业对接',instructions:`你正在固定测试数据的模拟作业场景，不具备真实解题或OCR能力。${captureInstructions}
此场景不允许修改现有任务评分、记忆或日程。确认创建后，通过“继续试排”切换到规划场景。`,tools:[...common,...draftTools],confirmationKinds:['task_draft']})

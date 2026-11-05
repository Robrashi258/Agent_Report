import { reactive, readonly } from 'vue'
const state=reactive({runId:null as string|null,revision:0})
export const agentNavigation=readonly(state)
export function openAgentRun(id:string):void{state.runId=id;state.revision++}

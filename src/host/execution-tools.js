import { defineTool } from '@deepseek-ai/dsh-tools'
const OUTPUT = {schema: {type: 'string'}, render: (_args, value) => [{type: 'text', text: String(value)}]}

export function install(rt) {
  const register = definition => rt.ctx.tools.register(defineTool({...definition, output: OUTPUT}))
  register({
    name: 'dwb_task_execution',
    description: '查看任务执行状态、结果依据和近期输入；按输入 id 分页读取完整内容。',
    parameters: {
      taskId: {type: 'string', description: '任务 id；省略时读取当前执行任务'},
      offset: {type: 'integer', description: '执行记录偏移，默认 0；每页最多 20 条'},
      inputId: {type: 'string', description: '从执行输入摘要取得的 id；设置后读取该输入正文'},
      inputOffset: {type: 'integer', description: '输入正文的字符偏移，默认 0；每页最多 4000 字符'},
    },
    async execute(args) {
      await rt.executionReady
      const caller = rt.currentExecution(), taskId = args.taskId ?? caller?.taskId
      if (caller && taskId !== caller.taskId) throw new Error('当前执行只能读取自己的任务')
      const inputs = rt.state.execution.inputs ?? []
      if (args.inputId) {
        const input = inputs.find(i => i.id === args.inputId && (!taskId || i.taskId === taskId))
        if (!input || (caller && input.runId !== caller.id)) throw new Error('输入不存在或不属于当前执行')
        const offset = Math.max(0, Number(args.inputOffset) || 0)
        return JSON.stringify({id: input.id, taskId: input.taskId, text: input.text.slice(offset, offset + 4000), nextInputOffset: offset + 4000 < input.text.length ? offset + 4000 : null})
      }
      const runs = rt.executionRuns(taskId), offset = Math.max(0, Number(args.offset) || 0)
      const items = runs.slice(offset, offset + 20).map(run => ({
        id: run.id, taskId: run.taskId, roleId: run.roleId, generation: run.generation,
        sessionId: run.sessionId, status: run.status, attempts: run.attempts, summary: run.summary,
        evidence: run.evidence, error: run.error, attention: run.attention,
        inputs: inputs.filter(i => i.runId === run.id && (!caller || run.id === caller.id)).slice(-10).map(i => ({id: i.id, kind: i.kind, status: i.status, preview: i.text.slice(0, 400), truncated: i.text.length > 400})),
      }))
      return JSON.stringify({error: rt.executionError ?? null, taskId, items, nextOffset: offset + 20 < runs.length ? offset + 20 : null})
    },
  })
  register({
    name: 'dwb_report_execution',
    description: '保存自己的执行状态、完整摘要与证据。系统仅生成简短完成/等待回执或异常提醒，执行中不刷群；不要重复发群消息。多人全部完成后自动关闭任务。',
    parameters: {
      runId: {type: 'string', description: '当前独立执行 id', required: true},
      status: {type: 'string', enum: ['running', 'waiting', 'blocked', 'completed', 'failed'], description: '执行中、等待后续、阻塞、完成或失败', required: true},
      summary: {type: 'string', description: '进展、结果或阻塞原因', required: true},
      evidence: {type: 'array', items: {type: 'string'}, description: '完成时必填：成果路径、验证结果或可核验引用'},
    },
    async execute(args, exec) {
      const result = await rt.reportExecution(args)
      if (args.status !== 'running') exec?.concludeTurn?.()
      return JSON.stringify({runId: result.id, taskId: result.taskId, status: result.status, summary: result.summary})
    },
  })
  register({
    name: 'dwb_manage_execution',
    description: '恢复暂停、阻塞或失败的任务，或停止其全部指派成员；已完成记录不会自动重跑。',
    parameters: {
      taskId: {type: 'string', description: '任务 id', required: true},
      action: {type: 'string', enum: ['retry', 'stop'], description: 'retry 恢复；stop 终止执行，终止后需重新派发任务', required: true},
    },
    async execute(args) {
      await rt.executionReady
      if (rt.currentExecution()) throw new Error('执行成员不能自行重启或停止任务；请向管理员报告')
      const runs = args.action === 'retry' ? await rt.retryExecution(args.taskId) : await rt.stopTaskExecution(args.taskId)
      return JSON.stringify({taskId: args.taskId, runs: runs.map(r => ({runId: r.id, roleId: r.roleId, status: r.status}))})
    },
  })
}

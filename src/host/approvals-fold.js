export const APPROVAL_KEY = 'dwbApprovals'
export const emptyApprovals = () => ({calls: [], approvals: []})
export function approvalDisplayItems(items) {
  const ordered=[...items].sort((a,b)=>a.askedAt-b.askedAt)
  const history = new Set(ordered.filter(a=>a.outcome!=='pending').slice(-40))
  return ordered.filter(a=>a.outcome==='pending'||history.has(a))
}
const settle = (items, id, outcome, time) => items.map(item => item.id === id && item.outcome === 'pending' ? {...item, outcome, decidedAt: time} : item)
const trim = approvalDisplayItems

/** Display cache only. No approval capability, resolver or authority is stored here. */
export function foldApprovals(state, event) {
  const data = event.data ?? {}
  if (event.type === 'tool/call') {
    return {...state, calls: [...state.calls, {id: data.callId, name: data.name, arguments: data.arguments ?? ''}].slice(-60)}
  }
  if (event.type === 'approval/asked') {
    if (state.approvals.some(a => a.id === data.id)) return state
    const call = state.calls.findLast(c => c.id === data.callId)
    let args = {}
    try { args = JSON.parse(call?.arguments ?? '{}') } catch { /* retain safe text fallback */ }
    const item = {id: data.id, toolName: data.toolName, callId: data.callId ?? '', reason: data.reason ?? '',
      command: String(args.command ?? args.file_path ?? call?.arguments ?? '').slice(0, 12000),
      permission: String(args.sandbox_permissions ?? ''), askedAt: event.time, outcome: 'pending'}
    return {...state, approvals: trim([...state.approvals, item])}
  }
  if (event.type === 'approval/decided') return {...state, approvals: trim(settle(state.approvals, data.id, data.outcome, event.time))}
  if (event.type === 'turn/end') {
    if (!state.approvals.some(a => a.outcome === 'pending')) return state
    return {...state, approvals: trim(state.approvals.map(a => a.outcome === 'pending' ? {...a, outcome: 'expired', decidedAt: event.time} : a))}
  }
  return state
}


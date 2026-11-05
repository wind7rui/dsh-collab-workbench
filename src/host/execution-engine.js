import { randomUUID } from 'node:crypto'

/** Replay only admission facts when recovering a cold Session. */
export function executionAdmission(events = []) {
  const inbox = {'next-turn': [], 'next-step': []}, read = new Set(), legacy = new Set()
  for (const event of events) {
    if (event.type === 'user/message') {
      const id = event.data?.source?.executionInputId
      if (id) read.add(id)
    } else if (event.type === 'agent/inbox/spliced' && inbox[event.data?.target]) {
      const data = event.data
      inbox[data.target].splice(data.start, data.removedCount ?? 0, ...(data.inserted ?? []))
    } else if (event.type === 'inbox/inserted') {
      const id = event.message?.source?.executionInputId
      if (id) legacy.add(id)
    }
  }
  const pending = new Set([...Object.values(inbox).flat().map(m => m.source?.executionInputId).filter(Boolean), ...legacy])
  return {read, pending}
}

const TERMINAL = new Set(['completed', 'cancelled'])
const ACTIVE = new Set(['starting', 'running', 'approval-wait'])
const REPORTS = new Set(['running', 'waiting', 'blocked', 'completed', 'failed'])
const PRIORITY = { 高: 0, high: 0, 中: 1, medium: 1, 低: 2, low: 2 }
const bounded = value => String(value ?? '').slice(0, 4000)
const clone = value => structuredClone(value)
const revision = task => JSON.stringify([task.title ?? '', task.description ?? '', task.dependencies ?? [], task.revision ?? 1])

/**
 * Durable scheduler. All mutations are serialized; transport callbacks must not
 * await calls back into this engine. persist() must durably save getState().
 * transport.deliver(run,input) must attach source.executionInputId = input.id to
 * the admitted user message/inbox event. Unknown admission is at-least-once:
 * after a crash an unlogged input may be sent again with the SAME id. The
 * transport should also deduplicate this id where possible. ensureSession(run)
 * should be idempotent by run.id (a crash can precede persisting its result).
 * maxAttempts counts execution starts per automatic retry budget. Explicit
 * retry resets it. canRun is a synchronous scheduling/delivery gate.
 */
export class ExecutionEngine {
  constructor({ getState, persist, transport, now = Date.now, maxConcurrent = 3,
    maxAttempts = 3, retryBaseMs = 1000, staleMs = 15 * 60 * 1000,
    canRun = () => true } = {}) {
    if (typeof getState !== 'function' || typeof persist !== 'function' || !transport)
      throw new TypeError('getState, persist and transport are required')
    for (const [key, value] of Object.entries({ maxConcurrent, maxAttempts })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${key} must be a positive integer`)
    }
    for (const [key, value] of Object.entries({ retryBaseMs, staleMs })) {
      if (!Number.isFinite(value) || value < 0) throw new TypeError(`${key} must be nonnegative`)
    }
    Object.assign(this, { getState, persist, transport, now, maxConcurrent, maxAttempts, retryBaseMs, staleMs, canRun })
    this.tail = Promise.resolve()
  }

  _serial(fn) {
    const result = this.tail.then(fn)
    this.tail = result.catch(() => {})
    return result
  }
  _state() {
    const state = this.getState()
    state.runs ??= []; state.inputs ??= []; state.version ??= 1
    return state
  }
  _touch(run) { run.updatedAt = this.now() }
  _heartbeat(run) {
    this._touch(run); run.lastActivityAt = this.now(); delete run.attention
  }
  _inputs(run) { return this._state().inputs.filter(input => input.runId === run.id) }
  _addInput(run, text, kind, eventId) {
    const inputs = this._state().inputs
    if (eventId !== undefined) {
      const prior = inputs.find(i => i.runId === run.id && i.eventId === eventId)
      if (prior) return prior
    }
    const input = { id: randomUUID(), runId: run.id, taskId: run.taskId,
      text: String(text ?? ''), kind, status: 'pending', attempts: 0,
      nextAt: this.now(), createdAt: this.now() }
    if (eventId !== undefined) input.eventId = eventId
    inputs.push(input)
    return input
  }
  _enqueue(task, { legacy = false, generation: requestedGeneration } = {}) {
    const runs = this._state().runs
    const previous = runs.filter(r => r.taskId === task.id)
    const generation = requestedGeneration ?? Math.max(1, ...previous.map(r => r.generation || 1))
    const created = []
    for (const roleId of new Set(task.assignees ?? [])) {
      if (previous.some(r => r.roleId === roleId && r.generation === generation && r.status !== 'cancelled')) continue
      const run = { id: randomUUID(), taskId: task.id, groupId: task.groupId,
        roleId, generation, sessionId: null, status: legacy ? 'paused' : 'queued',
        attempts: 0, createdAt: this.now(), updatedAt: this.now(), lastActivityAt: this.now(),
        summary: '', priority: task.priority, revision: revision(task), taskRevision: task.revision ?? 1,
        title: String(task.title ?? ''), description: String(task.description ?? '') }
      runs.push(run); created.push(run)
      this._addInput(run, [task.title, task.description].filter(Boolean).join('\n'), 'assignment')
    }
    return created
  }
  enqueue(task, options = {}) {
    return this._serial(async () => {
      const created = this._enqueue(task, options)
      await this.persist(); return clone(created)
    })
  }
  list(taskId) {
    return clone(this._state().runs.filter(r => taskId === undefined || r.taskId === taskId))
  }
  input(taskId, text, { eventId, roleIds, kind = 'followup' } = {}) {
    return this._serial(async () => {
      const created = []
      for (const run of this._state().runs) {
        // Paused/blocked/failed runs need explicit retry, including user stops.
        if (run.taskId !== taskId || !['queued', 'retry', 'starting', 'running', 'approval-wait', 'waiting'].includes(run.status)
          || (roleIds && !roleIds.includes(run.roleId))) continue
        created.push(this._addInput(run, text, kind, eventId))
        if (run.status === 'waiting') { run.status = 'queued'; run.attempts = 0; run.nextAt = this.now(); run.reminders = 0; this._heartbeat(run) }
      }
      await this.persist(); return clone(created)
    })
  }
  _finish(run, status) {
    run.approvalIds = []; run.status = status; this._touch(run)
    for (const input of this._inputs(run)) {
      if (status === 'cancelled' || !['read', 'cancelled'].includes(input.status)) input.status = 'cancelled'
    }
  }
  async _cancelSessions(runs) {
    for (const run of runs) {
      if (!run.sessionId) continue
      try { await this.transport.cancel(clone(run)) }
      catch (error) { run.cancelError = bounded(error?.message ?? error); await this.persist() }
    }
  }
  cancelTask(taskId) {
    return this._serial(async () => {
      const runs = this._state().runs.filter(r => r.taskId === taskId && !TERMINAL.has(r.status))
      for (const run of runs) this._finish(run, 'cancelled')
      await this.persist(); await this._cancelSessions(runs)
      return clone(runs)
    })
  }
  pauseRole(groupId, roleId) {
    return this._serial(async () => {
      const runs = this._state().runs.filter(r => (!groupId || r.groupId === groupId) && r.roleId === roleId && !TERMINAL.has(r.status))
      for (const run of runs) { run.approvalIds = []; run.status = 'paused'; run.summary = '用户停止或成员已停用'; this._touch(run) }
      await this.persist(); await this._cancelSessions(runs)
      return clone(runs)
    })
  }
  resolveDecision(taskId, text, {eventId, runId, commit = () => {}} = {}) {
    return this._serial(async () => {
      for (const run of this._state().runs.filter(r => r.taskId === taskId && (!runId || r.id === runId) && ['blocked','waiting'].includes(r.status))) {
        this._addInput(run, text, 'decision', eventId)
        run.status = 'queued'; run.nextAt = this.now(); run.attempts = 0; run.reported = false
        this._heartbeat(run)
      }
      commit()
      await this.persist()
    })
  }
  retryTask(taskId) {
    return this._serial(async () => {
      const runs = this._state().runs.filter(r => r.taskId === taskId && ['failed', 'blocked', 'paused', 'waiting'].includes(r.status))
      for (const run of runs) {
        run.status = 'queued'; run.attempts = 0; run.nextAt = this.now(); run.reminders = 0
        delete run.error; this._heartbeat(run)
        for (const input of this._inputs(run)) {
          if (['failed','sent','delivering'].includes(input.status)) { input.status = 'pending'; input.attempts = 0; input.nextAt = this.now() }
        }
        this._addInput(run, 'Explicit retry: resume this task and report status with evidence when complete.', 'recovery')
      }
      await this.persist(); return clone(runs)
    })
  }
  report(runId, { status, summary, evidence = [] } = {}) {
    return this._serial(async () => {
      const run = this._state().runs.find(r => r.id === runId)
      if (!run || TERMINAL.has(run.status) || run.status === 'paused') return false
      if (run.status === 'approval-wait') throw new Error('Cannot report while approval is pending')
      if (!REPORTS.has(status)) throw new TypeError('Unsupported execution report status')
      if (status === 'completed' && (!String(summary ?? '').trim() || !Array.isArray(evidence)
        || !evidence.some(item => item != null && (typeof item !== 'string' || item.trim()))))
        throw new TypeError('completed requires nonempty summary and evidence')
      if (!Array.isArray(evidence)) throw new TypeError('evidence must be an array')
      if (status === 'completed' && this._inputs(run).some(i => !['read','cancelled'].includes(i.status))) throw new Error('仍有未处理输入，请先处理新消息再完成任务')
      run.status = status; run.summary = bounded(summary); run.evidence = clone(evidence)
      run.reported = status !== 'running'; this._heartbeat(run)
      if (status === 'completed') this._finish(run, status)
      await this.persist(); return true
    })
  }
  async _failure(run, error, input) {
    run.error = bounded(error?.message ?? error)
    run.summary = bounded(`Execution needs retry: ${run.error}`)
    this._touch(run)
    if (run.attempts >= this.maxAttempts) {
      run.status = 'failed'
      for (const i of this._inputs(run)) if (['pending', 'delivering'].includes(i.status)) i.status = 'failed'
    } else {
      run.status = 'retry'
      run.nextAt = this.now() + this.retryBaseMs * 2 ** Math.min(30, Math.max(0, run.attempts - 1))
      if (input) { input.status = 'pending'; input.nextAt = run.nextAt; input.error = run.error }
    }
    await this.persist()
  }
  async _deliver(run) {
    if (run.status === 'approval-wait') return
    for (const input of this._inputs(run)) {
      if (input.status !== 'pending' || input.nextAt > this.now()) continue
      input.status = 'delivering'; input.attempts++; this._touch(run)
      await this.persist()
      try { await this.transport.deliver(clone(run), clone(input)) }
      catch (error) { await this._failure(run, error, input); return }
      input.status = 'sent'; run.status = 'running'; this._heartbeat(run)
      await this.persist()
    }
  }
  tick() {
    return this._serial(async () => {
      const runs = this._state().runs
      let changed = false
      for (const run of runs) {
        if (run.status === 'approval-wait' || this.now() - run.lastActivityAt < this.staleMs) continue
        if (ACTIVE.has(run.status)) {
          if (run.attention === 'stale') continue
          changed = true
          run.attention = 'stale'; run.summary = 'No recent activity; worker may still be active. Review required.'
        } else if (run.status === 'waiting' && !run.reported) {
          changed = true
          if ((run.reminders || 0) >= 1) {
            run.status = 'blocked'; run.summary = 'No execution report after one continuation reminder.'
          } else {
            run.reminders = 1; run.status = 'queued'
            this._addInput(run, 'Please continue or report waiting/blocked/completed with summary and evidence.', 'continuation')
          }
          this._heartbeat(run)
        }
      }
      if (changed) await this.persist()
      const candidates = runs.filter(r => ['queued', 'retry'].includes(r.status) && (r.nextAt ?? 0) <= this.now())
        .sort((a, b) => (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1) || a.createdAt - b.createdAt)
      for (const run of candidates) {
        const active = runs.filter(r => ACTIVE.has(r.status))
        if (active.length >= this.maxConcurrent) break
        if (active.some(r => r.roleId === run.roleId) || !this.canRun(clone(run))) continue
        if (run.attempts >= this.maxAttempts) { run.status = 'failed'; await this.persist(); continue }
        run.status = 'starting'; run.attempts++; run.reported = false; this._heartbeat(run)
        await this.persist()
        if (!run.sessionId) {
          let sessionId
          try { sessionId = await this.transport.ensureSession(clone(run)) }
          catch (error) { await this._failure(run, error); continue }
          if (!sessionId || runs.some(r => r.id !== run.id && r.sessionId === sessionId)) {
            await this._failure(run, new Error('ensureSession must return an independent session ID')); continue
          }
          run.sessionId = sessionId
          await this.persist()
        }
        run.status = 'running'; await this.persist()
      }
      for (const run of runs) {
        if (run.status === 'running' && this.canRun(clone(run))) await this._deliver(run)
      }
      return this.list()
    })
  }
  reconcileTask(task) {
    return this._serial(async () => {
      const old = this._state().runs.filter(r => r.taskId === task.id)
      const cancel = []
      if (task.status === '已完成') {
        for (const run of old.filter(r => !TERMINAL.has(r.status))) {
          this._finish(run, 'completed'); run.completedExternally = true
          run.summary = 'Task marked completed externally.'; cancel.push(run)
        }
      } else {
        const generation = Math.max(1, ...old.map(r => r.generation || 1))
        const current = old.filter(r => r.generation === generation)
        const revised = current.some(r => r.revision !== revision(task)) || (current.length > 0 && current.every(r => r.status === 'completed'))
        for (const run of old) {
          if (!TERMINAL.has(run.status) && (revised || !(task.assignees ?? []).includes(run.roleId))) {
            this._finish(run, 'cancelled'); cancel.push(run)
          }
          if (!revised) run.priority = task.priority
        }
        if (revised) {
          this._enqueue(task, { generation: generation + 1 })
        } else this._enqueue(task)
      }
      await this.persist(); await this._cancelSessions(cancel)
      return this.list(task.id)
    })
  }
  _markers(event) {
    // Durable inbox events may wrap the admitted message in payload/messages.
    const ids = new Set()
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 10) return
      if (node.source?.executionInputId) ids.add(node.source.executionInputId)
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') visit(value, depth + 1)
      }
    }
    visit(event, 0); return ids
  }
  async _event(run, event, admissionOnly = false) {
    if (TERMINAL.has(run.status) || ['paused', 'blocked', 'failed'].includes(run.status)) return false
    const type = event.type ?? event.kind
    const markers = this._markers(event)
    let admitted = false
    const read = type === 'user/message'
    for (const input of this._inputs(run)) {
      if (markers.has(input.id) && input.status !== 'cancelled') {
        if (read) { input.status = 'read'; input.readAt = event.time ?? this.now() }
        else if (input.status !== 'read') input.status = 'sent'
        admitted = true
      }
    }
    const replayed = Number.isInteger(event.seq) && event.seq <= (run.lastEventSeq ?? -1)
    if (admissionOnly || replayed) return admitted
    if (Number.isInteger(event.seq)) run.lastEventSeq = event.seq
    if (admitted) { if (run.status !== 'approval-wait') run.status = 'running'; this._heartbeat(run) }
    const data = event.data ?? {}
    if (type === 'approval/asked' && typeof data.id === 'string' && data.id) {
      run.approvalIds = [...new Set([...(run.approvalIds ?? []), data.id])]
      run.status = 'approval-wait'; this._heartbeat(run)
    } else if (type === 'approval/decided') {
      run.approvalIds = (run.approvalIds ?? []).filter(id => id !== data.id)
      if (run.status === 'approval-wait' && !run.approvalIds.length) run.status = 'running'
    }
    if (type === 'tool/result' || type === 'tool/call') this._heartbeat(run)
    if (type === 'turn/end') {
      run.approvalIds = []
      if (run.status === 'approval-wait') run.status = 'running'
      const status = event.data?.status ?? event.status ?? event.result?.status ?? event.outcome
      const cause = event.data?.cause ?? event.cause ?? event.reason ?? event.result?.cause
      if (status === 'aborted' && (cause === 'user' || cause === 'user-stop' || cause?.type === 'user')) {
        run.status = 'paused'; run.summary = 'Stopped by user.'; this._heartbeat(run)
      } else if (status === 'blocked') {
        run.status = 'blocked'; this._heartbeat(run)
      } else if (['error', 'interrupted', 'aborted', 'failed'].includes(status)) {
        await this._failure(run, new Error(bounded(event.error?.message ?? event.error ?? status)))
        if (run.status === 'retry') this._addInput(run, 'Continue interrupted work; report status and evidence.', 'recovery', `recovery:${run.attempts}`)
      } else if (status === 'completed' || status === 'success' || status === undefined) {
        // An ended turn is not a proof-backed task completion.
        const pending = this._inputs(run).some(i => ['pending','delivering'].includes(i.status))
        run.status = pending ? 'queued' : 'waiting'
        if (pending) {run.attempts = 0;run.nextAt = this.now();run.reported = false}
        this._heartbeat(run)
      }
    }
    return true
  }
  event(sessionId, event) {
    return this._serial(async () => {
      const run = this._state().runs.find(r => r.sessionId === sessionId)
      if (!run) return false
      const accepted = await this._event(run, event)
      if (accepted) await this.persist()
      return accepted
    })
  }
  recover(observations = new Map()) {
    return this._serial(async () => {
      for (const run of this._state().runs) {
        if (TERMINAL.has(run.status) || ['paused', 'blocked', 'failed'].includes(run.status)) continue
        const observation = observations.get(run.sessionId)
        // Audit history is authoritative for pending IDs, not the persisted cache.
        // This rebuild deliberately starts at the beginning, independent of lastEventSeq.
        const pendingApprovals = new Set(), seenSeq = new Set()
        for (const event of observation?.events ?? []) {
          if (Number.isInteger(event.seq)) {
            if (seenSeq.has(event.seq)) continue
            seenSeq.add(event.seq)
          }
          if (event.type === 'approval/asked' && typeof event.data?.id === 'string' && event.data.id) pendingApprovals.add(event.data.id)
          else if (event.type === 'approval/decided') pendingApprovals.delete(event.data?.id)
          else if (event.type === 'turn/end') pendingApprovals.clear()
        }
        run.approvalIds = observation?.running ? [...pendingApprovals] : []
        if (run.status === 'approval-wait') run.status = 'running'
        for (const event of observation?.events ?? []) {
          await this._event(run, event, true)
          if (event.type === 'turn/end' && Number.isInteger(event.seq) && event.seq > (run.lastEventSeq ?? -1)) await this._event(run, event)
        }
        // Approval-only observations must also advance the live replay watermark.
        for (const event of observation?.events ?? []) {
          if (Number.isInteger(event.seq)) run.lastEventSeq = Math.max(run.lastEventSeq ?? -1, event.seq)
        }
        if (TERMINAL.has(run.status) || ['paused', 'blocked', 'failed'].includes(run.status)) continue
        run.approvalIds = observation?.running ? [...pendingApprovals] : []
        const proof = executionAdmission(observation?.events ?? [])
        for (const input of this._inputs(run)) {
          if (input.status === 'cancelled') continue
          if (proof.read.has(input.id)) input.status = 'read'
          else if (proof.pending.has(input.id)) input.status = 'sent'
          else if (['delivering','sent'].includes(input.status)) { input.status = 'pending'; input.nextAt = this.now() }
        }
        if (observation?.running) {
          run.status = run.approvalIds.length ? 'approval-wait' : 'running'; this._heartbeat(run)
        } else if (ACTIVE.has(run.status)) {
          if (run.attempts >= this.maxAttempts) {
            run.status = 'failed'; run.error = 'Restart recovery attempt budget exhausted.'
          } else {
            run.status = 'queued'; run.nextAt = this.now()
            this._addInput(run, 'Recover interrupted execution; inspect prior work before continuing. Report status and evidence.', 'recovery', `recovery:${run.attempts}`)
          }
          this._touch(run)
        }
      }
      await this.persist(); return this.list()
    })
  }
}

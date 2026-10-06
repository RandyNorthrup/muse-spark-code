import { describe, expect, it, vi } from 'vitest'
import type { ScheduleRunDeps } from '../../src/core/schedules/unattended'
import { unattendedRun } from './helpers/schedules/unattended'
import { fakeRunContext } from './helpers/schedules/fixtures'
import { FakeScheduleApprovalStream } from './helpers/schedules/approvals'

describe.each(['modelApi', 'museCode'] as const)('unattended %s', (backend) => {
  it('refuses and settles every outside-grant request without leaving any approval pending', async () => {
    const stream = new FakeScheduleApprovalStream(backend)
    const { run, row } = unattendedRun()
    for (const action of stream.requestEveryClass()) {
      const decision = await run.decide(action)
      stream.decide(action.id, decision.allowed)
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBeTruthy()
    }
    stream.assertSettled()
    expect(row).toHaveBeenCalledTimes(stream.decisions.length)
    expect(run.refusedActions).toHaveLength(stream.decisions.length)
  })
  it('uses the live grant and audits allowed shell, edit, MCP and fetch actions without arguments', async () => {
    const context = fakeRunContext()
    context.grant.rules = [
      { id: 'npm', kind: 'command', prefix: 'npm test' },
      { id: 'src', kind: 'path', glob: 'src/**', access: 'edit' },
      { id: 'mcp', kind: 'tool', name: 'mcp' },
      { id: 'fetch', kind: 'tool', name: 'webFetch' },
    ]
    let isLive = true
    const { run, audit } = unattendedRun({ context, isActive: () => isLive })
    const stream = new FakeScheduleApprovalStream(backend)
    for (const kind of ['shell', 'edit', 'mcp', 'webFetch'] as const) {
      const action = stream.request(kind)
      const decision = await run.decide(action)
      expect(decision.allowed).toBe(true)
      stream.decide(action.id, decision.allowed)
    }
    stream.assertSettled()
    expect(audit).toHaveBeenCalledTimes(4)
    expect(audit.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'used',
          runId: context.runId,
          ruleId: 'npm',
          actionClass: 'shell',
        }),
      ]),
    )
    expect(JSON.stringify(audit.mock.calls)).not.toContain('npm test')
    isLive = false
    const decision = await run.decide(stream.request('shell'))
    expect(decision.allowed).toBe(false)
  })
  it('refuses canonical link escapes and protected paths even when the mode would permit the action', async () => {
    const { run } = unattendedRun({
      io: {
        realPath: (path) => {
          if (path.endsWith('link.ts')) return Promise.resolve('/outside/file.ts')
          return path.endsWith('alias.ts')
            ? Promise.resolve('/workspace/.git/hooks/hook')
            : Promise.resolve(path)
        },
      },
    })
    const action = new FakeScheduleApprovalStream(backend).request('edit')
    for (const path of ['src/link.ts', 'src/alias.ts', 'AGENTS.md', '../outside.ts']) {
      const decision = await run.decide({ ...action, paths: [path] }, false)
      expect(decision.allowed).toBe(false)
    }
  })
  it('refuses physical and person-required actions even when the mode allows, and binds requester safety', async () => {
    const stream = new FakeScheduleApprovalStream(backend)
    const { run } = unattendedRun()
    for (const kind of ['physical', 'requiresAsking', 'protectedPath'] as const) {
      const decision = await run.decide(stream.request(kind), false)
      expect(decision.allowed).toBe(false)
    }
    const context = fakeRunContext()
    context.grant.rules = [{ id: 'mcp', kind: 'tool', name: 'mcp' }]
    let requester: string | undefined
    const guarded = unattendedRun({
      context,
      safety: (_action, id) => {
        requester = id
        return 'Vault refused.'
      },
    }).run
    const denied = await guarded.decide(stream.request('mcp'), false)
    expect(denied.allowed).toBe(false)
    expect(requester).toBe(`schedule:${context.scheduleId}`)
  })
  it('cannot widen captured authority through a newer grant and refuses a revoked live grant', async () => {
    const context = fakeRunContext()
    const rule = { id: 'npm', kind: 'command', prefix: 'npm test' } as const
    const stream = new FakeScheduleApprovalStream(backend)
    const widened = unattendedRun({
      context,
      readGrant: () => Promise.resolve({ ...context.grant, rules: [rule] }),
    }).run
    const wideDecision = await widened.decide(stream.request('shell'))
    expect(wideDecision.allowed).toBe(false)
    context.grant.rules = [rule]
    const revoked = unattendedRun({ context, readGrant: () => Promise.resolve(undefined) }).run
    const revokedDecision = await revoked.decide(stream.request('shell'))
    expect(revokedDecision.allowed).toBe(false)
  })
  it('defers immediately through the open-question registry port and keeps the original question', async () => {
    const { run, deferQuestions } = unattendedRun()
    const event = {
      type: 'questionRequested',
      userInputId: 'question-1',
      itemId: 'item-1',
      questions: [],
    } as const
    await expect(run.defer({ ...event, questions: [] })).resolves.toBe('Deferred for later.')
    expect(deferQuestions).toHaveBeenCalledWith(event, run.context)
    expect(run.parts([{ type: 'text', text: 'Prompt' }])).toEqual([
      { type: 'text', text: 'Prompt' },
      { type: 'text', text: 'Scheduled; nobody is watching.' },
    ])
  })
  it('passes canonical paths to safety before permitting a read that feeds a request', async () => {
    const safety = vi
      .fn<ScheduleRunDeps['safety']>()
      .mockImplementation((action) =>
        action.paths.includes('assets/in.png') ? 'Canonical source refused.' : undefined,
      )
    const { run } = unattendedRun({
      safety,
      io: {
        realPath: (path) =>
          Promise.resolve(path.endsWith('alias.png') ? '/workspace/assets/in.png' : path),
      },
    })
    const action = new FakeScheduleApprovalStream(backend).request('mcp')
    const decision = await run.decide({ ...action, paths: ['alias.png'] }, false)
    expect(decision.allowed).toBe(false)
    expect(safety).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ['assets/in.png'] }),
      `schedule:${run.context.scheduleId}`,
    )
  })
  it('checks named attachments and refuses anonymous bytes before scheduled request admission', async () => {
    const { run } = unattendedRun()
    const file = {
      type: 'textFile',
      name: '.muse/private.txt',
      mediaType: 'text/plain',
      text: 'private bytes',
      sizeBytes: 13,
    } as const
    await expect(run.checkParts([file])).rejects.toThrow('Protected refused.')
    await expect(
      run.checkParts([
        { type: 'image', base64Data: 'AAAA', mediaType: 'image/png', width: 1, height: 1 },
      ]),
    ).rejects.toThrow('Person required.')
    await expect(run.checkParts([{ ...file, name: 'src/read.txt' }])).resolves.toBeUndefined()
  })
  it('Accept edits permits plain edits after safety and still refuses physical, protected and person-required actions', async () => {
    const context = { ...fakeRunContext(), mode: 'acceptEdits' as const }
    const { run } = unattendedRun({ context })
    const stream = new FakeScheduleApprovalStream(backend)
    const edit = await run.decide(stream.request('edit'))
    const shell = await run.decide(stream.request('shell'))
    expect(edit.allowed).toBe(true)
    expect(shell.allowed).toBe(false)
    for (const kind of ['physical', 'protectedPath', 'requiresAsking'] as const) {
      const decision = await run.decide(stream.request(kind))
      expect(decision.allowed).toBe(false)
    }
  })
  it('cannot enable paid extras through an ordinary tool grant or a hook requiring a person', () => {
    const { run } = unattendedRun()
    expect(run.allowsPaid('imageGeneration')).toBe(false)
    const paid = unattendedRun({
      paid: {
        modelId: 'model',
        accountId: 'digest',
        allows: () => true,
        reserve: () => Promise.reject(new Error('not dispatched')),
      },
    }).run
    expect(paid.allowsPaid('imageGeneration')).toBe(false)
    expect(paid.allowsPaid('imageGeneration', true)).toBe(false)
  })
  it('fails closed if auditing fails or revocation happens during the audit', async () => {
    const context = fakeRunContext()
    context.grant.rules = [{ id: 'npm', kind: 'command', prefix: 'npm test' }]
    const action = new FakeScheduleApprovalStream(backend).request('shell')
    const failed = unattendedRun({
      context,
      audit: () => Promise.reject(new Error('audit unavailable')),
    }).run
    const failedDecision = await failed.decide(action)
    expect(failedDecision.allowed).toBe(false)
    expect(failed.refusedActions).toHaveLength(1)
    let isActive = true
    const revoked = unattendedRun({
      context,
      isActive: () => isActive,
      audit: () => {
        isActive = false
        return Promise.resolve()
      },
    }).run
    const decision = await revoked.decide(action)
    expect(decision.allowed).toBe(false)
  })
})

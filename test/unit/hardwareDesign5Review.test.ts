import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { createHardwareContexts } from '../../src/core/maker/hardwareContext'
import type { HardwareContext } from '../../src/core/maker/guard/httpCommands'
import { UI_TEXT } from '../../src/shared/constants'
import { fakeMspHost, refusalOf } from './helpers/fakeMsp'
import { acpResumeEnvelope } from './helpers/acpMsp'
import { FakeLogOutputChannel } from './helpers/fakes'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function workspace(isHardware = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-guard5-review-'))
  roots.push(root)
  if (isHardware) writeFileSync(path.join(root, 'platformio.ini'), '[env]')
  return root
}
function setup(source: () => HardwareContext) {
  const h = fakeMspHost()
  const host = new MuseCodeHost(
    h.host,
    new FakeLogOutputChannel(),
    { normalMs: 2000, longMs: 2000 },
    undefined,
    undefined,
    undefined,
    source,
  )
  h.server.handle('session/start', () => ({
    session: { sessionId: 'old-1', modelId: 'muse-spark-1.3' },
  }))
  for (const method of ['turn/start', 'turn/steer', 'goal/set', 'goal/edit', 'goal/resume'])
    h.server.handle(method, () => ({ turnId: 't1', status: 'accepted' }))
  for (const method of [
    'subagent/followupTask',
    'subagent/sendMessage',
    'subagent/resume',
    'goal/pause',
    'goal/clear',
    'session/setApprovalMode',
    'session/userShell',
    'turn/cancel',
  ])
    h.server.handle(method, () => ({ status: 'accepted' }))
  h.server.handle('view/page', () => ({ events: [], nextCursor: null }))
  return { ...h, host }
}
const start = (host: MuseCodeHost, workspaceRoot: string) =>
  host.startSession({ workspaceRoot, modelId: 'muse-spark-1.3', approvalMode: 'onRequest' })

function stored(root: string, activeTurnId: string | null = null) {
  const envelope = acpResumeEnvelope()
  return { ...envelope, session: { ...envelope.session, workspaceRoot: root, activeTurnId } }
}

describe('Design 5 review execution boundaries', () => {
  it.each(['steer', 'followup', 'message', 'resumeChild', 'setGoal', 'editGoal', 'resumeGoal'])(
    'P1.1 refuses %s after an ordinary Bypass session latches',
    async (action) => {
      const root = workspace()
      let isHardwareWorkspace = false
      const h = setup(() => ({ workspaceRoot: root, isHardwareWorkspace }))
      try {
        const session = await h.host.startSession({
          workspaceRoot: root,
          modelId: 'muse-spark-1.3',
          approvalMode: 'allowAll',
        })
        isHardwareWorkspace = true
        let submission: Promise<unknown>
        switch (action) {
          case 'steer': {
            submission = session.steer('t1', [{ type: 'text', text: 'move' }])
            break
          }
          case 'followup':
          case 'message': {
            submission = session.messageSubagent('child', 'move', action === 'followup')
            break
          }
          case 'resumeChild': {
            submission = session.controlSubagent('child', 'resume')
            break
          }
          default: {
            submission = session.controlGoal(
              action === 'resumeGoal'
                ? { verb: 'resume' }
                : { verb: action === 'setGoal' ? 'set' : 'edit', objective: 'move' },
            )
          }
        }
        await expect(submission).rejects.toThrow(UI_TEXT.hardwareBindingUnavailable)
        expect(h.server.requests.map((request) => request.method)).toEqual(['session/start'])
        await session.cancel()
        await session.controlGoal({ verb: 'pause' })
        await session.controlGoal({ verb: 'clear' })
      } finally {
        await h.host.close()
      }
    },
  )
  it('P1.1 refuses a latch during sendTurn preparation before the start frame', async () => {
    const root = workspace()
    let isHardwareWorkspace = false
    const h = setup(() => ({ workspaceRoot: root, isHardwareWorkspace }))
    try {
      const session = await start(h.host, root)
      const submitted = session.sendTurn([{ type: 'text', text: 'move' }])
      isHardwareWorkspace = true
      await expect(submitted).rejects.toThrow(UI_TEXT.hardwareBindingUnavailable)
      expect(h.server.requestsFor('turn/start')).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })
  it('P1.1 rechecks a retry that admitted nothing before latching', async () => {
    const root = workspace()
    let isHardwareWorkspace = false
    const h = setup(() => ({ workspaceRoot: root, isHardwareWorkspace }))
    h.server.handle('turn/steer', () => {
      isHardwareWorkspace = true
      return refusalOf('overloaded', -32_001)()
    })
    try {
      const session = await start(h.host, root)
      await expect(session.steer('t1', [{ type: 'text', text: 'move' }])).rejects.toThrow(
        UI_TEXT.hardwareBindingUnavailable,
      )
      expect(h.server.requestsFor('turn/steer')).toHaveLength(1)
    } finally {
      await h.host.close()
    }
  })
  it('P1.2 rejects an injected lease for A before starting hardware workspace B', async () => {
    const a = workspace()
    const b = workspace(true)
    const contexts = createHardwareContexts(() => ({}))
    const h = setup(() => contexts(a).current())
    try {
      await expect(
        h.host.startSession({
          workspaceRoot: b,
          modelId: 'muse-spark-1.3',
          approvalMode: 'allowAll',
        }),
      ).rejects.toThrow()
      expect(h.server.requestsFor('session/start')).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })
  it('P1.2 rejects A ownership when reading B before resume', async () => {
    const a = workspace()
    const b = workspace(true)
    const contexts = createHardwareContexts(() => ({}))
    const h = setup(() => contexts(a).current())
    const envelope = stored(b)
    h.server.handle('session/read', () => envelope)
    h.server.handle('session/resume', () => envelope)
    try {
      await expect(h.host.resumeSession('old-1', 'muse-spark-1.3')).rejects.toThrow()
      expect(h.server.requestsFor('session/resume')).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })
  it.each([null, 'turn-9'])(
    'P1.3 refuses hardware resume before CLI entry, active=%s',
    async (activeTurnId) => {
      const root = workspace(true)
      const h = setup(() => ({ workspaceRoot: root }))
      const envelope = stored(root, activeTurnId)
      h.server.handle('session/read', () => envelope)
      h.server.handle('session/resume', () => envelope)
      try {
        await expect(h.host.resumeSession('old-1', 'muse-spark-1.3')).rejects.toThrow(
          UI_TEXT.hardwareBindingUnavailable,
        )
        expect(h.server.requests.map((request) => request.method)).toEqual(['session/read'])
        expect(h.host.sessionCount).toBe(0)
      } finally {
        await h.host.close()
      }
    },
  )

  it('P1.3 rechecks hardware before a refused resume is retried', async () => {
    const root = workspace()
    let isHardwareWorkspace = false
    const h = setup(() => ({ workspaceRoot: root, isHardwareWorkspace }))
    const envelope = stored(root)
    h.server.handle('session/read', () => envelope)
    h.server.handle('session/resume', () => {
      if (h.server.requestsFor('session/resume').length === 1) {
        isHardwareWorkspace = true
        return refusalOf('overloaded', -32_001)()
      }
      return envelope
    })
    try {
      await expect(h.host.resumeSession('old-1', 'muse-spark-1.3')).rejects.toThrow(
        UI_TEXT.hardwareBindingUnavailable,
      )
      expect(h.server.requestsFor('session/resume')).toHaveLength(1)
      expect(h.host.sessionCount).toBe(0)
    } finally {
      await h.host.close()
    }
  })
})

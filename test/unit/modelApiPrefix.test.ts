// M101 lane A: request-only goal progress, stable local date and cache diagnostics.
import { describe, expect, it } from 'vitest'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { localPromptDate } from '../../src/core/backends/modelapi/instructions'
import { parseStoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'

async function setup(changes: Partial<ModelApiHostDeps> = {}) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: '/ws', io, log }),
    ...changes,
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'onRequest',
  })
  if (!(session instanceof ModelApiSession)) throw new TypeError('expected Model API session')
  const watch = watchSessionTurns(session)
  return { api, log, host, session, ...watch }
}

describe('M101 stable request prefix', () => {
  it('keeps goal progress outside instructions and key and never saves the suffix', async () => {
    const t = await setup()
    t.api.script(
      {
        calls: [
          {
            name: 'create_goal',
            arguments: '{"objective":"Ship it","token_budget":1000}',
            callId: 'goal',
          },
        ],
      },
      {
        calls: [
          {
            name: 'report_progress',
            arguments: '{"percent_complete":50,"current_work":"Tests","next_work":"Docs"}',
            callId: 'progress',
          },
        ],
      },
      { calls: [{ name: 'update_goal', arguments: '{"status":"complete"}', callId: 'complete' }] },
      { text: 'Done.' },
    )
    await t.session.sendTurn([{ type: 'text', text: 'Set a goal and finish it.' }])
    await t.turnDone()
    const bodies = t.api.responseBodies()
    expect(bodies).toHaveLength(4)
    expect(bodies[1]?.['instructions']).toBe(bodies[2]?.['instructions'])
    expect(bodies[1]?.['prompt_cache_key']).toBe(bodies[2]?.['prompt_cache_key'])
    expect(bodies[1]?.['instructions']).not.toContain('Tokens used:')
    expect(bodies[1]?.['instructions']).not.toContain('- Progress:')
    expect(JSON.stringify(bodies[2]?.['input'])).toContain('- Current work: Tests')
    expect(JSON.stringify(bodies[2]?.['input'])).toContain('- Progress: 50%')
    expect(JSON.stringify(bodies[1]?.['input'])).not.toContain('- Current work: Tests')
    expect(JSON.stringify(bodies[3]?.['input'])).not.toContain('# Session goal progress')
    expect(bodies[0]?.['instructions']).toBe(bodies[3]?.['instructions'])
    expect(JSON.stringify(t.session.snapshot().replay)).not.toContain('# Session goal progress')
    expect(t.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('media fit changed replay length'),
    )
    await t.host.close()
  })

  it('uses the local date once and keeps it across midnight, resume and fork', async () => {
    let now = new Date(2026, 9, 4, 23, 59).getTime()
    const t = await setup({ now: () => now })
    t.api.script({ text: 'First.' }, { text: 'Second.' })
    await t.session.sendTurn([{ type: 'text', text: 'Hello.' }])
    await t.turnDone()
    now = new Date(2026, 9, 5, 1).getTime()
    await t.session.sendTurn([{ type: 'text', text: 'Again.' }])
    await t.turnDone()
    const bodies = t.api.responseBodies()
    expect(bodies[0]?.['instructions']).toContain("Today's date: 2026-10-04")
    expect(bodies[1]?.['instructions']).toBe(bodies[0]?.['instructions'])
    expect(bodies[1]?.['prompt_cache_key']).toBe(bodies[0]?.['prompt_cache_key'])
    const stored = parseStoredSession(t.session.snapshot())
    if (!stored.ok) throw new Error(stored.reason)
    expect(stored.session.promptDate).toBe('2026-10-04')
    const resumed = await setup({ now: () => now })
    resumed.session.adopt(stored.session)
    resumed.api.script({ text: 'Resumed.' })
    await resumed.session.sendTurn([{ type: 'text', text: 'Continue.' }])
    await resumed.turnDone()
    expect(resumed.api.responseBodies()[0]?.['instructions']).toBe(bodies[0]?.['instructions'])
    const fork = await setup({ now: () => now })
    t.session.copyInto(fork.session, undefined)
    expect(fork.session.snapshot().promptDate).toBe('2026-10-04')
    await Promise.all([t.host.close(), resumed.host.close(), fork.host.close()])
  })

  it('reads calendar fields instead of the UTC date', () => {
    const now = new Date(2026, 9, 4, 23, 59).getTime()
    expect(localPromptDate(now)).toBe('2026-10-04')
  })
})

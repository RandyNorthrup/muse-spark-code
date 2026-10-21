// The Muse Code approval-mode failure paths, live (lane PR251FIX3B, PLAN.md
// D211). Opt-in only, never in CI: each drill spawns the pinned Muse Code
// binary over stdio (`serve --provider echo`) and drives the REAL
// `MuseCodeHost`/`MuseSession` against it. No turn runs on a model: the echo
// provider answers control commands, and the two echo turns below only prove
// a session was not quarantined. Runs when MUSE_LIVE_SESSION_MODES=1, with
// MUSE_PINNED_147/MUSE_PINNED_144 pointing at the binaries (defaults: the
// rig's pinned pair).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnMspConnection } from '@muse-code/sdk'
import { MuseCodeHost, type MuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import { MSP_CLIENT_NAME, MSP_REQUESTED_CAPABILITIES } from '../../src/shared/constants'
import { stderrLogger } from '../../src/runtime/stderrLog'

const IS_ENABLED = process.env['MUSE_LIVE_SESSION_MODES'] === '1'
const BIN_147 =
  process.env['MUSE_PINNED_147'] ?? '/home/randy/lanes/_rig/muse-pinned/1.4.7-R6101.1/muse-bin'
const BIN_144 =
  process.env['MUSE_PINNED_144'] ?? '/home/randy/lanes/_rig/muse-pinned/1.4.4-R5419.1/muse-bin'
// Spawning the pinned CLI over stdio; every command is a real process round-trip.
const DRILL_TIMEOUT_MS = 120_000

const log = stderrLogger(() => undefined, 'warn')

interface LiveHost {
  readonly host: MuseCodeHost
  readonly workspaceRoot: string
  readonly close: () => Promise<void>
}

/** The real host over a real handshake; `hasExperimentalApi` mirrors production. */
async function spawnHost(binary: string, hasExperimentalApi: boolean): Promise<LiveHost> {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'muse-modes-'))
  const handshake = spawnMspConnection({
    command: binary,
    args: ['serve', '--provider', 'echo'],
    cwd: workspaceRoot,
    env: { ...process.env },
    onStderr: () => undefined,
  })
  const spawned = await handshake.initialize({
    clientInfo: { name: MSP_CLIENT_NAME, version: '0.0.0-live-modes' },
    capabilities: {
      userInputDialogs: true,
      requestedCapabilities: [...MSP_REQUESTED_CAPABILITIES],
      ...(hasExperimentalApi && { experimentalApi: true }),
    },
  })
  const host = new MuseCodeHost(
    {
      connection: spawned.connection,
      initializeResult: spawned.initializeResult,
      exited: spawned.exited,
      close: () => spawned.close(),
    },
    log,
  )
  return {
    host,
    workspaceRoot,
    close: async () => {
      try {
        await host.close()
      } finally {
        rmSync(workspaceRoot, { recursive: true, force: true })
      }
    },
  }
}

async function defaultModelId(host: MuseCodeHost): Promise<string> {
  const models = await host.listModels()
  const model = models.find((candidate) => candidate.isDefault) ?? models[0]
  if (model === undefined) throw new Error('the pinned host served no models')
  return model.modelId
}

/**
A refused mode change on the real session: returns the throw, which must
be the kept-mode error naming the running mode (never a silent change or
a quarantine with the reviewer sentence).
*/
async function refusedChange(
  session: Pick<MuseSession, 'setApprovalMode'>,
  mode: string,
): Promise<{ actualMode?: unknown }> {
  let thrown: unknown = undefined
  try {
    await session.setApprovalMode(mode)
  } catch (error: unknown) {
    thrown = error
  }
  expect(thrown).toBeDefined()
  const { isModeKeptError } = await import('../../src/core/agent/agentBackend')
  expect(typeof isModeKeptError).toBe('function')
  expect(isModeKeptError(thrown)).toBe(true)
  return thrown as { actualMode?: unknown }
}

describe.skipIf(!IS_ENABLED)('approval-mode failures, live (MUSE_LIVE_SESSION_MODES=1)', () => {
  const live: LiveHost[] = []
  afterAll(async () => {
    for (const entry of live.splice(0)) await entry.close()
  })

  beforeAll(() => {
    if (!IS_ENABLED) return
  })

  it.each([
    {
      name: 'a refused mode change keeps the seeded mode and refuses nothing',
      binary: BIN_147,
      // The host never changed: the throw names the running mode instead of
      // quarantining with the reviewer sentence.
      mode: 'not-a-mode-the-host-knows',
    },
    {
      name: 'an old host keeps the mode when its profile step fails',
      binary: BIN_144,
      // 1.4.4 answers the profile switch with kind=internal (recorded
      // 2026-10-19): the mode command stands or rolls back, but the host is
      // never left running a mode it does not name, and turns stay live.
      mode: 'promptUnmatched',
    },
  ])(
    '$name',
    async ({ binary, mode }) => {
      const entry = await spawnHost(binary, true)
      live.push(entry)
      const { host, workspaceRoot } = entry
      const modelId = await defaultModelId(host)
      const session = await host.startSession({ workspaceRoot, modelId, approvalMode: 'onRequest' })
      const thrown = await refusedChange(session, mode)
      expect(thrown.actualMode).toBe('onRequest')
      // Not quarantined: a turn still sends on the kept mode.
      const submission = await session.sendTurn([{ type: 'text', text: 'ping' }])
      expect(typeof submission.turnId).toBe('string')
    },
    DRILL_TIMEOUT_MS,
  )

  it(
    'resume names the rolled-back mode when the profile step is refused',
    async () => {
      const entry = await spawnHost(BIN_147, false)
      live.push(entry)
      const { host, workspaceRoot } = entry
      const modelId = await defaultModelId(host)
      const started = await host.startSession({ workspaceRoot, modelId, approvalMode: 'onRequest' })
      const loaded = await host.resumeSession(started.sessionId, modelId)
      // The envelope seeds the handle: the first change rolls back like a live one.
      expect(loaded.record.approvalMode?.mode).toBe('onRequest')
      // The profile refusal rolled back: the throw names the running mode.
      const thrown = await refusedChange(loaded.session, 'promptUnmatched')
      expect(thrown.actualMode).toBe('onRequest')
      // The restored mode runs: a turn still sends.
      const submission = await loaded.session.sendTurn([{ type: 'text', text: 'ping' }])
      expect(typeof submission.turnId).toBe('string')
    },
    DRILL_TIMEOUT_MS,
  )
})

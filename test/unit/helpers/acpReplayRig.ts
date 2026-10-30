// A real ACP agent on a real MuseCodeHost over the replay wire, for suites
// that assert what the editor hears. Every wire byte is recorded live with
// zero model calls: the 1.4.11 echo capture (test/fixtures/acphonest/) for
// the start, the mode acks and the released broadcasts, plus the 1.4.7 echo
// capture's model/list (1.4.11 serves the echo catalogue empty).
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Connection } from '@muse-code/sdk'
import type { PermissionMode } from '../../../src/shared/constants'
import { createAcpAgent } from '../../../src/acp/agent'
import { AcpMakerSurface } from '../../../src/acp/maker'
import { AcpPaidUse } from '../../../src/acp/paid'
import { MuseCodeHost } from '../../../src/core/backends/musecode/MuseCodeHost'
import { paidGrantFile } from '../../../src/runtime/paidGrants'
import { type Answer, recordedResult, refuseUnscripted, ReplayWire } from './museReplay'
import { levelLogger, type LoggedMessage } from './collectingLogger'

export function acpFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/acphonest/${name}`, import.meta.url), 'utf8'),
  )
}

export interface AcpReplayLive {
  readonly host: MuseCodeHost
  readonly wire: ReplayWire
  readonly folder: string
  readonly agent: ReturnType<typeof createAcpAgent>
  readonly logged: LoggedMessage[]
}

const live: { host: MuseCodeHost; wire: ReplayWire; folder: string; logged: LoggedMessage[] }[] = []

/** Start the rig; the suite closes it with `closeAcpReplayRigs` in `afterEach`. */
export function startAcpReplayRig(initialMode: PermissionMode = 'manual'): AcpReplayLive {
  const wire = new ReplayWire()
  const acks: Readonly<Record<string, unknown>> = {
    onRequest: acpFixture('mode-ack-onRequest-1.4.11.json'),
    denyUnmatched: acpFixture('mode-ack-denyUnmatched-1.4.11.json'),
    allowAll: acpFixture('mode-ack-allowAll-1.4.11.json'),
    promptUnmatched: acpFixture('mode-ack-promptUnmatched-1.4.11.json'),
  }
  const skills = acpFixture('skill-list-1.4.11.json')
  wire.answer = (method, params): Answer => {
    switch (method) {
      case 'model/list': {
        return { result: recordedResult(2) }
      }
      case 'session/start': {
        return { result: acpFixture('session-start-1.4.11.json') }
      }
      case 'session/setReasoningEffort': {
        return { result: acpFixture('session-setReasoningEffort-1.4.11.json') }
      }
      case 'session/setPermissionProfile': {
        return { result: acpFixture('session-setPermissionProfile-1.4.11.json') }
      }
      case 'skill/list': {
        return { result: skills }
      }
      case 'session/setApprovalMode': {
        const ack = typeof params['mode'] === 'string' ? acks[params['mode']] : undefined
        return ack === undefined ? refuseUnscripted(method) : { result: ack }
      }
      default: {
        return refuseUnscripted(method)
      }
    }
  }
  const logged: LoggedMessage[] = []
  const log = levelLogger(logged)
  const connection = new Connection(wire.transport())
  const host = new MuseCodeHost(
    {
      connection,
      initializeResult: acpFixture('initialize-1.4.11.json'),
      exited: Promise.withResolvers<{ code: number | null; signal: string | null }>().promise,
      close: async () => {
        wire.finish()
        await connection.close()
      },
    },
    log,
  )
  const folder = mkdtempSync(path.join(tmpdir(), 'acp-replay-'))
  const agent = createAcpAgent({
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: '0.19.0',
    options: { canBypass: false, allowsContributorModels: false, initialMode },
    signIn: {
      id: 'login',
      name: 'Muse Code',
      description: 'Muse Code',
      args: [],
      command: 'muse login',
    },
    defaultCwd: folder,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: paidGrantFile({
        file: path.join(folder, 'paid-grants.json'),
        log,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
      log,
    }),
    maker: new AcpMakerSurface({ log }),
    log,
    questions: 'decline',
  })
  live.push({ host, wire, folder, logged })
  return { host, wire, folder, agent, logged }
}

export async function closeAcpReplayRigs(): Promise<void> {
  for (const entry of live.splice(0)) {
    entry.wire.finish()
    await entry.host.close()
    rmSync(entry.folder, { recursive: true, force: true })
    entry.logged.length = 0
  }
}

/** The recorded broadcast params for a capture file. */
export function acpNoteParams(name: string): Record<string, unknown>[] {
  return acpFixture(name) as Record<string, unknown>[]
}

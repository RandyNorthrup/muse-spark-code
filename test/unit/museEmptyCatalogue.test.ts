// RLF-EMPTYCAT (RSCH-MUSE-F): a signed-in host that serves zero models is
// said, not obeyed. When `muse serve` answers `model/list` with an empty
// catalogue for a signed-in account (meta-models/muse-code-sdk#115, #106,
// #110), the panel keeps the last good catalogue for display and session
// start, says one plain sentence that Meta's list came back empty and is
// asked again, retries on Meta's documented backoff, and recovers without
// a restart when the list returns. Never an access accusation on this
// evidence: the only words the panel says while the list is empty are the
// sentence.
//
// The empty frame is real, served by the real CLI, never simulated:
// `muse serve` 1.4.14 under a throwaway HOME+XDG answers `model/list`
// with `{"models": [], "source": "bundledCatalog"}` (fixture
// test/fixtures/muse-empty-catalogue/, captured 2026-11-02, zero model
// calls). The first suite below re-drives that state live wherever the
// CLI is installed; the panel suites run the real controller and a real
// MuseCodeHost over the SDK's real Connection fed with the recorded
// frames. `model/list` is never mocked: the replay script answers with
// recorded bytes, and unscripted methods are refused loudly.
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMspConnection } from '@muse-code/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emptyCatalogueMaxRetries,
  emptyCatalogueRetryDelayMs,
  isEmptyCatalogueEpisode,
} from '../../src/core/backends/musecode/emptyCatalogue'
import { resolveInstalledMuse } from './helpers/installedMuse'
import {
  modelListResultSchema,
  toModelSummary,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { PROXY_VARIABLE_SPELLINGS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import {
  awaitPosts,
  conversationPanel,
  modelApiRig,
  panelNotices,
  turnAcceptances,
} from './helpers/conversationPanel'
import { liveTurnScript, sendFirst } from './helpers/museLiveTurn'
import {
  closeLiveHosts,
  startLiveHost,
  type Answer,
  type LiveHost,
  type ReplayWire,
} from './helpers/museReplay'
import { removeFolder } from './helpers/temporaryFolders'

const EMPTY_LIST: Record<string, unknown> = JSON.parse(
  readFileSync(
    new URL('../fixtures/muse-empty-catalogue/model-list-empty-1.4.14.json', import.meta.url),
    'utf8',
  ),
)
const HEALTHY_LIST: Record<string, unknown> = JSON.parse(
  readFileSync(
    new URL('../fixtures/muse-empty-catalogue/model-list-healthy-1.4.14.json', import.meta.url),
    'utf8',
  ),
)
const HEALTHY_IDS = ['muse-wonder-1.0', 'muse-wonder-full-1.0', 'muse-spark-1.3', 'muse-spark-1.2']

/** The real CLI the product would run, found as the product finds it; why not when it is not there. */
const MUSE = resolveInstalledMuse({
  localAppData: process.env['LOCALAPPDATA'],
  workspaceRoot: process.cwd(),
})
const SKIPPED_WITHOUT_CLI = 'missing' in MUSE ? ` (SKIPPED: ${MUSE.missing})` : ''
// Spawning the real CLI and waiting for its first answers is genuinely slow.
const CASE_MS = 30_000
// The proxy port nothing answers: no request the CLI makes reaches Meta.
const DEAD_PROXY = 'http://127.0.0.1:9/'

describe(`the empty served catalogue, live${SKIPPED_WITHOUT_CLI}`, () => {
  it.skipIf('missing' in MUSE)(
    'a signed-out serve answers model/list with the #115 shape',
    async () => {
      if ('missing' in MUSE) throw new Error('the CLI went missing mid-suite')
      const home = await mkdtemp(path.join(tmpdir(), 'emptycat-home-'))
      try {
        // RLF-MACCRED isolation: the throwaway home holds every home
        // variable, the credential variables are gone, every proxy
        // spelling points at the dead port. The machine's own sign-in is
        // untouched: no token read, no sign-in or sign-out made.
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: path.join(home, '.config'),
          XDG_DATA_HOME: path.join(home, '.data'),
          XDG_CACHE_HOME: path.join(home, '.cache'),
          XDG_STATE_HOME: path.join(home, '.state'),
        }
        delete env['MUSE_AUTH_PATH']
        delete env['META_API_KEY']
        delete env['TBH_CREDENTIAL_BACKEND']
        for (const spelling of PROXY_VARIABLE_SPELLINGS) env[spelling] = DEAD_PROXY
        const handshake = spawnMspConnection({
          command: MUSE.command,
          args: ['serve', '--disable-sandbox'],
          shutdownTimeoutMs: 5000,
          env,
          onStderr: () => undefined,
        })
        try {
          const connection = await handshake.initialize({
            clientInfo: { name: 'emptycat_suite', version: '0.0.0' },
            capabilities: { experimentalApi: true },
          })
          // Logged out proves the isolation held: no credential reached it.
          const account = await connection.connection.command('account/read', {})
          expect(account['state']).toBe('loggedOut')
          const served = await connection.connection.command('model/list', {})
          expect(served['models']).toEqual([])
          expect(served['source']).toBe('bundledCatalog')
          // The product's own reader takes the served shape whole.
          const parsed = modelListResultSchema.parse(served)
          expect(parsed.models.map((row) => toModelSummary(row))).toEqual([])
        } finally {
          await handshake.close()
        }
      } finally {
        await removeFolder(home)
      }
    },
    CASE_MS,
  )
})

/** Every modelList the panel posted, in post order. */
function modelLists(posted: readonly HostToWebviewMessage[]): readonly string[][] {
  return posted.flatMap((message) =>
    message.type === 'modelList' ? [message.models.map((model) => model.modelId)] : [],
  )
}

/** The sentence is the only words the panel said: said once, never anything else. */
function expectOnlySentence(posted: readonly HostToWebviewMessage[]): void {
  expect(panelNotices(posted)).toEqual([{ level: 'warning', text: EN.metaCatalogueEmptyRetrying }])
}

async function awaitListings(wire: ReplayWire, count: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (wire.sentCount('model/list') >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    `only ${String(wire.sentCount('model/list'))} model/list calls, wanted ${String(count)}`,
  )
}

/**
The catalogue retry's clock, held shut until the test releases it: the
suite watches the asked waits, then lets the burst run. One gate for the
whole burst: a single release lets every wait fire, like the resend
suite's clock. Jitter draws 0, so the asked waits are exactly Meta's
documented backoff.
*/
function gatedCatalogueClock(): {
  readonly waits: number[]
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  readonly release: () => void
} {
  const waits: number[] = []
  const gate = Promise.withResolvers<undefined>()
  return {
    waits,
    sleep: (ms: number, signal: AbortSignal): Promise<void> => {
      waits.push(ms)
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('the catalogue wait was already stopped'))
          return
        }
        signal.addEventListener(
          'abort',
          () => {
            reject(new Error('the catalogue wait stopped'))
          },
          { once: true },
        )
        void gate.promise.then(resolve)
      })
    },
    release: (): void => {
      gate.resolve(undefined)
    },
  }
}

function cataloguePanel(
  directory: string,
  script: (method: string, params: Record<string, unknown>) => Answer,
  clock: ReturnType<typeof gatedCatalogueClock>,
): { readonly panel: ReturnType<typeof conversationPanel>; readonly live: LiveHost } {
  const live = startLiveHost(script)
  const rig = modelApiRig(directory)
  const panel = conversationPanel({
    rig,
    directory,
    isNamespaceKnown: true,
    backend: 'museCode',
    modelId: 'muse-spark-1.3',
    ensureHost: () => Promise.resolve(live.host),
    catalogueRetrySleep: clock.sleep,
    catalogueRetryRandom: () => 0,
  })
  return { panel, live }
}

/** The recorded answers with `model/list` served from `lists` in call order. */
function catalogueScript(
  lists: readonly Record<string, unknown>[],
): (method: string, params: Record<string, unknown>) => Answer {
  const base = liveTurnScript()
  let calls = 0
  return (method: string): Answer => {
    if (method === 'model/list') {
      const frame = lists[Math.min(calls, lists.length - 1)]!
      calls += 1
      return { result: frame }
    }
    return base(method)
  }
}

/** A panel sent once over the recorded answers, its first listing answered. */
async function sendOnScript(
  directory: string,
  script: (method: string, params: Record<string, unknown>) => Answer,
): Promise<{
  readonly rig: ReturnType<typeof cataloguePanel>
  readonly clock: ReturnType<typeof gatedCatalogueClock>
}> {
  const clock = gatedCatalogueClock()
  const rig = cataloguePanel(directory, script, clock)
  await sendFirst(rig.panel)
  await awaitPosts(rig.panel, turnAcceptances, 1, 'turns accepted')
  await awaitListings(rig.live.wire, 1)
  return { rig, clock }
}

describe('the panel on an empty served catalogue', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'emptycat-panel-'))
  })
  afterEach(async () => {
    await closeLiveHosts()
    await removeFolder(directory)
  })

  it('says the sentence and retries on Meta backoff, never posting an empty picker', async () => {
    const { rig, clock } = await sendOnScript(directory, catalogueScript([EMPTY_LIST]))
    // The empty list is said, not obeyed: no modelList post presents it
    // as truth, and the sentence is the only words the panel says.
    expect(modelLists(rig.panel.posted)).toEqual([])
    expectOnlySentence(rig.panel.posted)
    // The burst retries on Meta's documented backoff: 500 ms doubling to
    // 4 s, four retries after the first try, then it stops with the
    // sentence staying and the picker still unposted.
    clock.release()
    await awaitListings(rig.live.wire, 5)
    expect(clock.waits).toEqual([500, 1000, 2000, 4000])
    expect(modelLists(rig.panel.posted)).toEqual([])
    expectOnlySentence(rig.panel.posted)
  })

  it('keeps the last good catalogue for display when the list empties', async () => {
    const { rig } = await sendOnScript(directory, catalogueScript([HEALTHY_LIST, EMPTY_LIST]))
    expect(modelLists(rig.panel.posted)).toEqual([HEALTHY_IDS])
    // The backend generation goes away and the next listing comes back
    // empty: the last good catalogue stays on display with the sentence.
    rig.panel.controller.confidentialWorkspaceChanged()
    await awaitListings(rig.live.wire, 2)
    const lists = modelLists(rig.panel.posted)
    expect(lists.at(-1)).toEqual(HEALTHY_IDS)
    expectOnlySentence(rig.panel.posted)
  })

  it('recovers without a restart when the list returns', async () => {
    const { rig, clock } = await sendOnScript(
      directory,
      catalogueScript([EMPTY_LIST, HEALTHY_LIST]),
    )
    expect(modelLists(rig.panel.posted)).toEqual([])
    // The first retry finds the list back: the catalogue posts, the
    // episode ends, and no further retry is asked.
    clock.release()
    await awaitListings(rig.live.wire, 2)
    await awaitPosts(rig.panel, modelLists, 1, 'model lists')
    expect(modelLists(rig.panel.posted)).toEqual([HEALTHY_IDS])
    expect(clock.waits).toEqual([500])
    expectOnlySentence(rig.panel.posted)
  })

  it('still recovers on a later listing after the burst is spent', async () => {
    let isEmpty = true
    const { rig, clock } = await sendOnScript(
      directory,
      (method: string, params: Record<string, unknown>) =>
        catalogueScript([isEmpty ? EMPTY_LIST : HEALTHY_LIST])(method, params),
    )
    clock.release()
    await awaitListings(rig.live.wire, 5)
    expect(modelLists(rig.panel.posted)).toEqual([])
    // The fault outlasts the burst; a later listing finds the list back
    // and the panel recovers with no restart and no second sentence.
    isEmpty = false
    rig.panel.controller.confidentialWorkspaceChanged()
    await awaitPosts(rig.panel, modelLists, 1, 'model lists')
    expect(modelLists(rig.panel.posted)).toEqual([HEALTHY_IDS])
    expectOnlySentence(rig.panel.posted)
  })
})

describe('the empty-catalogue decision and waits', () => {
  it('starts an episode only on zero served rows while signed in on the Muse Code backend', () => {
    const signedIn = { servedCount: 0, backendKind: 'museCode', signedIn: true } as const
    expect(isEmptyCatalogueEpisode(signedIn)).toBe(true)
    expect(isEmptyCatalogueEpisode({ ...signedIn, servedCount: 4 })).toBe(false)
    expect(isEmptyCatalogueEpisode({ ...signedIn, signedIn: false })).toBe(false)
    expect(isEmptyCatalogueEpisode({ ...signedIn, backendKind: 'modelApi' })).toBe(false)
    expect(isEmptyCatalogueEpisode({ ...signedIn, backendKind: 'external' })).toBe(false)
  })

  it('retries four times on Meta’s documented backoff, capped at the shared ceiling', () => {
    // Meta documents 3–5 attempts: the first try plus four retries.
    expect(emptyCatalogueMaxRetries()).toBe(4)
    // No jitter: exactly 500 ms doubling per try.
    expect([0, 1, 2, 3].map((attempt) => emptyCatalogueRetryDelayMs(attempt, 0))).toEqual([
      500, 1000, 2000, 4000,
    ])
    // Full jitter stays under the shared 8 s ceiling, far out included.
    for (const attempt of [0, 1, 2, 3, 10]) {
      const delay = emptyCatalogueRetryDelayMs(attempt, 0.999)
      expect(delay).toBeGreaterThanOrEqual([500, 1000, 2000, 4000, 8000][attempt] ?? 8000)
      expect(delay).toBeLessThanOrEqual(8000)
    }
  })
})

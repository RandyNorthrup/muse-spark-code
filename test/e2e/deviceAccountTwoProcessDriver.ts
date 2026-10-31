// M108 D two-process drill child: the sender routes account work to the
// receiver by the pinned device's headroom; the receiver admits with its
// own record and confirmations. Bundled by deviceAccountTwoProcess.e2e.test.ts
// with esbuild; never imported by tests. All stdout lines are signals the
// parent matches; diagnostics go to stderr.
//
// Each side owns one temp dir and runs the real account services over it:
// the file metadata, the store with its placement port, the routing
// layer, the journal, the gate and the confirmations. The drill's file
// channel carries D's own fragments (the offer record, the account request
// fragment) the way RLM100's drill carries invitations through files; the
// live M100 transport binding is RLF-DEVICES. Admission on both sides is
// the harness's own consent (both processes are drill-owned), fenced on
// the real placement snapshot and live offers at every check; M100 consent
// and M107's atomic reservation bind with RLF-DEVICES. No vendor is called:
// dispatch records the admission and settles the real journal.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { accountPoolBase } from '../unit/helpers/accountPoolBase'
import { memoryVault } from '../unit/helpers/memoryVault'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import { accountHeadroomBucket } from '../../src/core/accounts/headroomBucket'
import {
  createAccountPlacements,
  localPlacementDeviceMatcher,
  localPlacementId,
} from '../../src/core/accounts/placement'
import { AccountPool, type AccountPoolRequest } from '../../src/core/accounts/pool'
import {
  AccountRouteError,
  RemoteAccountPool,
  deviceAccountRequestSchema,
  type AccountRouteRequest,
  type DeviceAccountClaim,
} from '../../src/core/team/remotePool'
import { AccountStore, type AccountsMetadataPort } from '../../src/core/providers/accounts'
import { accountPolicyFor } from '../../src/core/providers/accountPolicy'
import { modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'
import { DeviceAccountReceiver } from '../../src/host/devices/deviceReceiver'
import { fileAccountsMetadata } from '../../src/runtime/providers/providersFileStore'
import { AccountRequestJournal } from '../../src/runtime/providers/accountRequestJournal'
import { FileRemoteLimitStore } from '../../src/runtime/providers/accountRemoteLimits'
import { ownerColdCacheUsd } from '../../src/runtime/providers/accountRequestOwner'
import { deviceAccountHeadroomSchema } from '../../src/shared/devices'
import { parseUsd } from '../../src/shared/accountUsd'
import { ACCOUNT_REQUEST_STORE, UI_TEXT } from '../../src/shared/constants'
import type { AccountTrigger } from '../../src/shared/accounts'
import { fileConfirmationStore } from '../unit/helpers/accountConfirmationStore'
import { rigArg } from './driverArgs'

const MODEL = 'muse-spark-1.3'
const PROVIDER = 'meta'
const POLL_MS = 50
const FILE_BUDGET_MS = 10_000

const VENDOR_LIMIT: AccountTrigger = { kind: 'vendorLimit', reason: 'rateLimited', resetAt: null }
const USER_CAP: AccountTrigger = {
  kind: 'userCap',
  metric: 'requests',
  period: 'day',
  value: 10,
  threshold: 5,
  resetAt: '2026-10-30T00:00:00.000Z',
}

function signal(line: string): void {
  process.stdout.write(`${line}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForFile(file: string, missing: string): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    if (existsSync(file)) return
    if (Date.now() - startedAt > FILE_BUDGET_MS) throw new Error(missing)
    await sleep(POLL_MS)
  }
}

interface Side {
  readonly dir: string
  readonly localDevice: string
  readonly metadata: AccountsMetadataPort
  readonly store: AccountStore
  readonly placements: ReturnType<typeof createAccountPlacements>
}

function openSide(dir: string, known: readonly string[]): Side {
  mkdirSync(dir, { recursive: true })
  const metadata = fileAccountsMetadata(dir)
  const localDevice = localPlacementId(dir)
  const store = new AccountStore(metadata, memoryVault(), {
    localDevice: () => localDevice,
    isOnePerDevice: () => true,
  })
  const placements = createAccountPlacements({
    store,
    metadata,
    listProviders: () => metadata.listProviders(),
    localDevice,
    isKnownDevice: (device) =>
      localPlacementDeviceMatcher(localDevice)(device) || known.includes(device),
    isOnePerDevice: () => true,
  })
  return { dir, localDevice, metadata, store, placements }
}

// The harness's own consented claim. Both processes are drill-owned, so
// consent is inherent; every check still re-validates the real fenced
// state the binder closes over. M100 consent and M107's atomic
// reservation bind with RLF-DEVICES.
function consentedClaim(fenced: () => void, outcomes: string): DeviceAccountClaim {
  return {
    check: fenced,
    finish: (outcome: 'notSent' | 'returned' | 'uncertain'): Promise<void> => {
      appendFileSync(outcomes, `${outcome}\n`)
      return Promise.resolve()
    },
  }
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown
}

async function runSender(
  dir: string,
  exchange: string,
  peer: string,
  peerId: string,
): Promise<void> {
  const side = openSide(dir, [peerId])
  if (localPlacementId(peer) !== peerId) throw new Error('peer device mismatch')
  const outcomes = path.join(dir, 'claims.jsonl')
  const offerFile = path.join(exchange, 'offer.json')
  // The migrated default holds this device; the second account pins to the peer.
  await side.store.add(PROVIDER, {
    id: 'br1',
    label: 'B one',
    order: 1,
    device: peerId,
    thresholds: {},
  })
  const rows = await side.store.list(PROVIDER)
  await waitForFile(offerFile, 'peer offer not found')
  // What the sender routed on, kept for the parent: the offer file itself
  // is withdrawn in the last phase.
  writeFileSync(path.join(dir, 'offer-seen.json'), readFileSync(offerFile, 'utf8'))

  const readOffers = (): {
    device: string
    headroom: Record<string, 'ample' | 'some' | 'none'>
  }[] => {
    if (!existsSync(offerFile)) return []
    const raw = JSON.parse(readFileSync(offerFile, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null) throw new Error('peer offer malformed')
    const { device, offer } = raw as { device?: unknown; offer?: unknown }
    if (device !== peerId) throw new Error('peer offer names another device')
    return [{ device: peerId, headroom: deviceAccountHeadroomSchema.parse(offer) }]
  }
  const hasLiveOffers = (): boolean => readOffers().length > 0
  const limitStore = new FileRemoteLimitStore(path.join(dir, 'remote-limits'))
  const openPool = (): RemoteAccountPool =>
    new RemoteAccountPool({
      placements: side.placements,
      accounts: () => rows,
      policy: (provider) => accountPolicyFor(provider, 'model-api'),
      now: () => Date.now(),
      limitStore,
      offers: readOffers,
      // The selected-model capability part of canRoute, from the real record;
      // pair epoch, permission and governor bind with RLF-DEVICES.
      canRoute: (_device, request) =>
        modelPolicyFor(request.modelId).identity.provider === request.provider,
      admit: async () => {
        const snapshot = await side.placements.snapshot()
        return consentedClaim(() => {
          snapshot.check()
          if (!hasLiveOffers()) throw new AccountRouteError('routeUnavailable')
        }, outcomes)
      },
    })
  const pool = openPool()

  const send = async (tag: string, request: AccountRouteRequest): Promise<void> => {
    const fragmentFile = path.join(exchange, `frag-${tag}.json`)
    const resultFile = path.join(exchange, `result-${tag}.json`)
    const value = await pool.run(request, async (route) => {
      route.beforeSend()
      // Exactly the fragment the pool would send, no more.
      writeFileSync(fragmentFile, JSON.stringify(route.request))
      await waitForFile(resultFile, `result ${tag} not found`)
      const result = readJson(resultFile) as { value?: unknown }
      if (typeof result.value !== 'string') throw new TypeError(`result ${tag} malformed`)
      return result.value
    })
    if (value !== 'served-br1') throw new Error(`phase ${tag} served elsewhere: ${value}`)
  }

  // Phase 1: a worker fans out past the vendor-limited local account.
  await send('1', {
    provider: PROVIDER,
    modelId: MODEL,
    trigger: VENDOR_LIMIT,
    account: 'default',
    owner: 'drill-w1',
    kind: 'worker',
    budgetOwner: 'drill-w1',
  })
  signal('ROUTED-1')
  // Phase 2: the manual Send to {device} choice at a user cap.
  await send('2', {
    provider: PROVIDER,
    modelId: MODEL,
    trigger: USER_CAP,
    account: 'default',
    owner: 'drill-w2',
    kind: 'worker',
    budgetOwner: 'drill-w2',
    destination: peerId,
  })
  signal('ROUTED-2')

  const expectRefusal = async (
    tag: string,
    target: RemoteAccountPool,
    request: AccountRouteRequest,
    code: 'missingDevice' | 'routeUnavailable',
  ): Promise<void> => {
    try {
      await target.run(request, () => Promise.reject(new Error(`${tag} unexpectedly dispatched`)))
      throw new Error(`${tag} unexpectedly routed`)
    } catch (error: unknown) {
      if (!(error instanceof AccountRouteError) || error.code !== code) throw error
    }
    signal(tag)
  }

  // Phase 3: a manual choice that names no live device never falls back.
  await expectRefusal(
    'MISSING-DEVICE-OK',
    pool,
    {
      provider: PROVIDER,
      modelId: MODEL,
      account: 'default',
      owner: 'drill-w3',
      kind: 'worker',
      budgetOwner: 'drill-w3',
      destination: 'missing-device-1',
    },
    'missingDevice',
  )
  // Phase 4: the peer reports the second account limited too, so the
  // overlapping fence stops this owner with nothing sent.
  await expectRefusal(
    'OVERLAP-STOP-OK',
    pool,
    {
      provider: PROVIDER,
      modelId: MODEL,
      trigger: VENDOR_LIMIT,
      account: 'default',
      owner: 'drill-w1',
      kind: 'worker',
      budgetOwner: 'drill-w1',
    },
    'routeUnavailable',
  )
  const ownerKey = JSON.stringify([PROVIDER, 'worker', 'drill-w1'])
  const stored = await limitStore.read(ownerKey)
  const block = stored as { isOverlapping?: unknown } | undefined
  if (block?.isOverlapping !== true) throw new Error('the overlapping fence was not persisted')
  // Phase 4b: a fresh instance restores the durable fence, as after restart.
  await expectRefusal(
    'RESTORE-STOP-OK',
    openPool(),
    {
      provider: PROVIDER,
      modelId: MODEL,
      account: 'default',
      owner: 'drill-w1',
      kind: 'worker',
      budgetOwner: 'drill-w1',
    },
    'routeUnavailable',
  )
  // Phase 5: the peer withdraws its offer, so nothing is routable.
  unlinkSync(offerFile)
  await expectRefusal(
    'WITHDRAWN-STOP-OK',
    pool,
    {
      provider: PROVIDER,
      modelId: MODEL,
      account: 'default',
      owner: 'drill-w5',
      kind: 'worker',
      budgetOwner: 'drill-w5',
    },
    'routeUnavailable',
  )
  signal('SENDER-DONE')
}

async function runReceiver(dir: string, exchange: string): Promise<void> {
  const side = openSide(dir, [])
  const outcomes = path.join(dir, 'claims.jsonl')
  // This machine holds exactly one account of the provider, pinned here.
  await side.store.remove(PROVIDER, 'default')
  await side.store.add(PROVIDER, { id: 'br1', label: 'B receiver', order: 0, thresholds: {} })
  const rows = await side.store.list(PROVIDER)
  const journal = new AccountRequestJournal(path.join(dir, ACCOUNT_REQUEST_STORE.directory), () =>
    Date.now(),
  )
  const asked: { provider: string; product: string }[] = []
  const confirmations = new AccountConfirmations({
    machineId: 'drill-receiver',
    now: () => Date.now(),
    // The drill user's own answers on this machine, recorded per question.
    ask: (row) => {
      asked.push({ provider: row.provider, product: row.product })
      return Promise.resolve('confirm')
    },
    store: fileConfirmationStore(path.join(dir, 'confirmations')),
  })
  const pool = new AccountPool({
    ...accountPoolBase({
      provider: PROVIDER,
      journal,
      rows,
      confirmations,
      now: () => Date.now(),
    }),
    settings: () => ({ isSwapOn: true, isParallelOn: true }),
    headroom: (row) => journal.headroom(row, PROVIDER),
    canUseModel: (_row, request) => modelPolicyFor(request.modelId).identity.provider === PROVIDER,
    coldCache: (_previous, _next, request) =>
      ownerColdCacheUsd(request.modelId, request.estimate.inputTokens),
    reserve: (row, estimate, request) =>
      Promise.resolve(journal.reserve(PROVIDER, row.id, estimate, request)),
    record: (event) => {
      journal.record(event)
      return Promise.resolve()
    },
    commit: (event, adopt) => {
      journal.commit(event, adopt)
    },
    sharedGroupNotice: () => Promise.reject(new Error(UI_TEXT.accounts.vendorLimit)),
  })
  const estimate = {
    costUsd: parseUsd('0.02'),
    inputTokens: 100,
    outputTokens: 50,
    requests: 1,
  }
  const probe = (account: string): AccountPoolRequest => ({
    owner: 'drill-offer',
    budgetOwner: 'drill-offer',
    modelId: MODEL,
    kind: 'worker',
    account,
    estimate,
    isInteractive: true,
  })
  const receiver = new DeviceAccountReceiver({
    providers: () => [PROVIDER],
    pool: (provider) => (provider === PROVIDER ? pool : undefined),
    offerRequest: (provider) => {
      if (provider !== PROVIDER) throw new Error(UI_TEXT.accounts.invalidAccount)
      return probe('br1')
    },
    isPinnedHere: (provider, account) => {
      const entry = side.metadata.readNow?.(provider)
      const row = entry?.accounts?.find((candidate) => candidate.id === account)
      return row !== undefined && (row.device ?? side.localDevice) === side.localDevice
    },
    placementFence: async () => {
      const snapshot = await side.placements.snapshot()
      return snapshot.check
    },
    headroom: (provider, account) => {
      const row = rows.find((candidate) => candidate.id === account)
      if (row === undefined) throw new Error(UI_TEXT.accounts.invalidAccount)
      const limits = journal.limits(provider, account, row)
      return accountHeadroomBucket(journal.headroom(row, provider), 'blocked' in limits)
    },
    admit: async () => {
      const snapshot = await side.placements.snapshot()
      return consentedClaim(snapshot.check, outcomes)
    },
    // Built from this machine's own session, model and budgets. The
    // sender's budget owner travels in M100's dispatch with RLF-DEVICES;
    // the harness channel carries no budget identity at all. The paired
    // device has its user present, so the vendor-terms confirmation opens
    // there; a headless receiver reads only grants recorded on its machine.
    // No shared caps are set on this drill machine, so none can trip.
    request: (fragment) => ({
      owner: 'drill-receiver',
      budgetOwner: 'drill-receiver',
      modelId: fragment.modelId,
      kind: 'worker',
      account: 'br1',
      estimate,
      isInteractive: true,
      checkSharedCaps: () => undefined,
    }),
  })
  writeFileSync(
    path.join(exchange, 'offer.json'),
    JSON.stringify({ device: side.localDevice, offer: receiver.offer() }),
  )
  signal('OFFER-WRITTEN')
  for (const tag of ['1', '2']) {
    const fragmentFile = path.join(exchange, `frag-${tag}.json`)
    await waitForFile(fragmentFile, `fragment ${tag} not found`)
    const fragment = deviceAccountRequestSchema.parse(readJson(fragmentFile))
    const value = await receiver.receive(fragment, (admission) => {
      admission.beforeSend()
      if (admission.account !== 'br1') throw new Error(`served by ${admission.account}`)
      const served = `served-${admission.account}`
      writeFileSync(
        path.join(exchange, `result-${tag}.json`),
        JSON.stringify({ value: served, account: admission.account }),
      )
      return Promise.resolve({ value: served, actualUsd: admission.estimate.costUsd })
    })
    if (value !== 'served-br1') throw new Error(`phase ${tag} returned ${value}`)
    signal(`SERVED-${tag}`)
  }
  writeFileSync(path.join(dir, 'asked.json'), JSON.stringify(asked))
  signal('RECEIVER-DONE')
}

async function run(): Promise<void> {
  const role = rigArg('role')
  const dir = rigArg('dir')
  const exchange = rigArg('exchange')
  mkdirSync(exchange, { recursive: true })
  if (role === 'sender') await runSender(dir, exchange, rigArg('peer'), rigArg('peer-id'))
  else if (role === 'receiver') await runReceiver(dir, exchange)
  else throw new Error(`bad role ${role}`)
}

try {
  await run()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'failed'}\n`)
  process.exitCode = 1
}

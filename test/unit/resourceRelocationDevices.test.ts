// M100-R: the paired-device relocation route. A linked offer covers the
// repository and the kind across separators, the router moves a queued
// check to it through the real governor, host and relocator, and the
// teams binding completes the join so registration succeeds. Refusal
// anywhere keeps the check local.
import { afterEach, describe, expect, it } from 'vitest'
import {
  hasDeviceLinkOffer,
  ResourceRunnerRouter,
  resourceRunnerPreference,
  routeChecks,
  type CheckJob,
  type CheckResult,
  type CheckRoutingDeps,
  type DeviceCheckLink,
  type DeviceCheckSend,
  type ResourceRunnerRouteOptions,
} from '../../src/core/runners/routing'
import {
  configureResources,
  hasResourceRunnerRoutes,
  registerResourceRunnerRoutes,
  resourceRunnerRoutesJoin,
} from '../../src/core/resources/admission'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import { createTeamRunnersRuntime } from '../../src/host/runners/teamRunnersEntry'
import { deviceOfferSchema, type DeviceOffer } from '../../src/shared/devices'
import { RESOURCE_ESCALATE_MS, RESOURCE_MIN_DWELL_MS } from '../../src/shared/constants'
import { resourceSettingsSchema, type ResourceSettings } from '../../src/shared/resources'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { manualClock } from './resourceHarness'

setUiText(EN, 'en')

const PAIR_ID = 'a'.repeat(32)
const DEVICE_ID = 'b'.repeat(32)
const REPO = '/work/repo'

function checksOffer(): DeviceOffer {
  return deviceOfferSchema.parse({
    deviceId: DEVICE_ID,
    receiverIncarnationId: 'c'.repeat(32),
    poolId: 'd'.repeat(32),
    repositoryId: 'e'.repeat(32),
    grantId: 'f'.repeat(32),
    grantRevision: 1,
    platform: 'darwin',
    toolchainDigest: '0'.repeat(64),
    lanes: false,
    checks: true,
    caps: { workers: 0, processes: 1, heavyChecks: 1, tokens: 0, spendUsd: 0, artifactBytes: 0 },
    entries: [],
    checkIds: ['1'.repeat(32)],
  })
}

function lanesOffer(): DeviceOffer {
  return deviceOfferSchema.parse({
    deviceId: DEVICE_ID,
    receiverIncarnationId: 'c'.repeat(32),
    poolId: 'd'.repeat(32),
    repositoryId: 'e'.repeat(32),
    grantId: 'f'.repeat(32),
    grantRevision: 1,
    platform: 'darwin',
    toolchainDigest: '0'.repeat(64),
    lanes: true,
    checks: false,
    caps: { workers: 1, processes: 1, heavyChecks: 0, tokens: 0, spendUsd: 0, artifactBytes: 0 },
    entries: [
      {
        entryId: '2'.repeat(32),
        roleId: '3'.repeat(32),
        model: { providerId: 'local', modelId: 'model' },
        capabilities: {
          vision: false,
          tools: true,
          structuredOutput: true,
          hostedSearch: false,
          reasoningEffort: false,
        },
        readiness: 'ready',
        payer: 'local',
        caps: {
          workers: 1,
          processes: 1,
          heavyChecks: 0,
          tokens: 0,
          spendUsd: 0,
          artifactBytes: 0,
        },
      },
    ],
    checkIds: [],
  })
}

function linkFor(offer: DeviceOffer, repositoryPath = REPO): DeviceCheckLink {
  return {
    pairId: PAIR_ID,
    label: 'Mac worker',
    offer,
    repositoryPath,
    resource: () => Promise.resolve({ level: 'normal', headroom: 'ample' }),
  }
}

describe('device offer matching', () => {
  it('covers the offered kind on the linked repository', () => {
    expect(hasDeviceLinkOffer(linkFor(checksOffer()), REPO, 'check')).toBe(true)
    expect(hasDeviceLinkOffer(linkFor(checksOffer()), REPO, 'worker')).toBe(false)
    expect(hasDeviceLinkOffer(linkFor(lanesOffer()), REPO, 'worker')).toBe(true)
    expect(hasDeviceLinkOffer(linkFor(lanesOffer()), REPO, 'check')).toBe(false)
  })

  it('refuses another repository', () => {
    expect(hasDeviceLinkOffer(linkFor(checksOffer()), '/work/other', 'check')).toBe(false)
    expect(hasDeviceLinkOffer(linkFor(checksOffer(), '/work/other'), REPO, 'check')).toBe(false)
  })

  it('matches paths across separators', () => {
    expect(
      hasDeviceLinkOffer(linkFor(checksOffer(), 'C:/work/repo'), String.raw`C:\work\repo`, 'check'),
    ).toBe(true)
    expect(
      hasDeviceLinkOffer(linkFor(checksOffer(), String.raw`C:\work\repo`), 'C:/work/repo', 'check'),
    ).toBe(true)
  })
})

function preference(level: 'relocate' | 'normal', hasRunner: boolean, hasDevices: boolean) {
  return resourceRunnerPreference({
    level,
    relocation: 'paired',
    queued: true,
    keepHere: false,
    approvedRunner: () => (hasRunner ? { id: 'ssh' } : undefined),
    hasDeviceOffer: () => hasDevices,
  })
}

describe('relocation preference with devices', () => {
  it('proposes a device-only move with no SSH runner', () => {
    const proposal = preference('relocate', false, true)
    expect(proposal).toMatchObject({ runner: undefined, reason: 'machineBusy' })
  })

  it('keeps the SSH proposal when a runner approves', () => {
    expect(preference('relocate', true, false)).toMatchObject({ runner: { id: 'ssh' } })
    expect(preference('relocate', true, true)).toMatchObject({ runner: { id: 'ssh' } })
  })

  it('declines with no route at all', () => {
    expect(preference('relocate', false, false)).toBeUndefined()
    expect(preference('normal', false, true)).toBeUndefined()
  })
})

interface DeviceCalls {
  asked: number
  rows: number
  notices: number
  traffics: number
  sends: number
  probes: number
  settled: ('kept' | 'admitted' | 'uncertain')[]
  locals: number
  errors: unknown[]
}

async function pressuredHost(
  settings: ResourceSettings,
  errors: unknown[],
): Promise<{
  host: ResourceLaunchHost
  governor: ResourceGovernor
  clear: () => void
}> {
  const { clock, clear, advance } = manualClock()
  const events = new ResourceEvents((error) => {
    errors.push(error)
  })
  const governor = new ResourceGovernor({
    clock,
    events,
    settings,
    sampler: createMachineResourceSampler(() => settings, {
      timeoutMs: 1000,
      maxOutputBytes: 64 * 1024,
    }),
    // R binds approved availability; the test binds a route below.
    hasRelocationTarget: () => hasResourceRunnerRoutes(),
    onError: (error) => {
      errors.push(error)
    },
  })
  const host = new ResourceLaunchHost({
    governor,
    events,
    clock,
    settings: () => settings,
    bindTree: () => Promise.resolve(null),
    onError: (error) => {
      errors.push(error)
    },
  })
  try {
    await governor.refresh()
    advance(RESOURCE_MIN_DWELL_MS)
    await governor.refresh()
    advance(RESOURCE_ESCALATE_MS)
    await governor.refresh()
  } catch (error: unknown) {
    governor.dispose()
    clear()
    throw error
  }
  return { host, governor, clear }
}

async function routeOnDevices(input: {
  links: readonly DeviceCheckLink[]
  send: DeviceCheckSend
  relocate?: ResourceSettings['relocate']
  cwd?: string
}): Promise<{ result: CheckResult; calls: DeviceCalls }> {
  const errors: unknown[] = []
  const calls: DeviceCalls = {
    asked: 0,
    rows: 0,
    notices: 0,
    traffics: 0,
    sends: 0,
    probes: 0,
    settled: [],
    locals: 0,
    errors,
  }
  const settings = resourceSettingsSchema.parse({
    memoryMaxPercent: 1,
    relocate: input.relocate ?? 'paired',
  })
  const wasComplete = resourceRunnerRoutesJoin.isComplete
  resourceRunnerRoutesJoin.isComplete = true
  const unregister = registerResourceRunnerRoutes(() => true)
  const { host, governor, clear } = await pressuredHost(settings, errors)
  try {
    expect(host.status().level).toBe('relocate')
    const links = input.links.map((link) => ({
      ...link,
      resource: () => {
        calls.probes += 1
        return link.resource()
      },
    }))
    const options: ResourceRunnerRouteOptions = {
      port: {
        status: () => host.status(),
        createRelocator: (relocatorOptions) => host.createRelocator(relocatorOptions),
      },
      headless: false,
      hasTarget: () => false,
      devicesEnabled: () => true,
      deviceLinks: () => links,
      isHeavy: () => true,
      phase: () => 'queued',
      isApproved: () => false,
      claim: () => true,
      settle: (_job, result) => {
        calls.settled.push(result)
      },
      ask: () => {
        throw new Error('SSH ask must not run for a device move')
      },
      deviceAsk: () => {
        calls.asked += 1
        return Promise.resolve(true)
      },
      row: () => {
        throw new Error('SSH row must not run for a device move')
      },
      deviceRow: () => {
        calls.rows += 1
      },
      notice: () => {
        throw new Error('SSH notice must not run for a device move')
      },
      deviceNotice: () => {
        calls.notices += 1
      },
      traffic: () => {
        throw new Error('SSH traffic must not run for a device move')
      },
      deviceTraffic: () => {
        calls.traffics += 1
      },
      deviceSend: () => {
        calls.sends += 1
        return Promise.resolve(input.send)
      },
      onError: (error) => {
        errors.push(error)
      },
    }
    const router = new ResourceRunnerRouter(options, unregister)
    try {
      const job: CheckJob = {
        runId: 'run-1',
        cwd: input.cwd ?? REPO,
        command: 'npm test',
        timeoutMs: 1000,
        commandClass: 'tests',
        labels: [],
        preferredRunners: [],
        lockfiles: [],
        signal: new AbortController().signal,
        onOutput: () => undefined,
      }
      const deps: CheckRoutingDeps = {
        isTrusted: () => true,
        localLabels: [],
        sample: () => {
          throw new Error('SSH sample must not run for a device move')
        },
        remote: () => {
          throw new Error('SSH remote must not run for a device move')
        },
        local: (localJob) => {
          calls.locals += 1
          return Promise.resolve({
            runId: localJob.runId,
            exitCode: 0,
            output: 'local-check-output',
            location: 'local',
          })
        },
        resources: router,
      }
      const result = await routeChecks(job, [], deps, (guarded) => Promise.resolve(guarded.command))
      return { result, calls }
    } finally {
      router.dispose()
      governor.dispose()
    }
  } finally {
    unregister()
    resourceRunnerRoutesJoin.isComplete = wasComplete
    clear()
  }
}

describe('device check relocation', () => {
  it('moves a queued check to the linked offer', async () => {
    const { result, calls } = await routeOnDevices({
      links: [linkFor(checksOffer())],
      send: {
        admission: 'admitted',
        result: { runId: 'run-1', exitCode: 0, output: 'device-check-output', location: 'paired' },
      },
    })
    expect(result.output).toBe('device-check-output')
    expect(calls.settled).toEqual(['admitted'])
    expect(calls.rows).toBe(1)
    expect(calls.sends).toBe(1)
    // Select probes once and the pre-dispatch recheck probes again; a
    // duplicated target would probe three times.
    expect(calls.probes).toBe(2)
    expect(calls.notices).toBe(1)
    expect(calls.traffics).toBe(1)
    expect(calls.locals).toBe(0)
    expect(calls.errors).toEqual([])
  })

  it('asks first when the setting says ask', async () => {
    const { result, calls } = await routeOnDevices({
      links: [linkFor(checksOffer())],
      send: {
        admission: 'admitted',
        result: { runId: 'run-1', exitCode: 0, output: 'device-check-output', location: 'paired' },
      },
      relocate: 'ask',
    })
    expect(result.output).toBe('device-check-output')
    expect(calls.asked).toBe(1)
    expect(calls.settled).toEqual(['admitted'])
    expect(calls.errors).toEqual([])
  })

  it('keeps the check local when the device refuses', async () => {
    const { result, calls } = await routeOnDevices({
      links: [linkFor(checksOffer())],
      send: { admission: 'refused' },
    })
    expect(result.output).toBe('local-check-output')
    expect(calls.settled).toEqual(['kept'])
    expect(calls.sends).toBe(1)
    expect(calls.locals).toBe(1)
    expect(calls.errors).toEqual([])
  })

  it('keeps the check local when no offer covers the repository', async () => {
    const { result, calls } = await routeOnDevices({
      links: [linkFor(checksOffer(), '/work/other')],
      send: {
        admission: 'admitted',
        result: { runId: 'run-1', exitCode: 0, output: 'device-check-output', location: 'paired' },
      },
    })
    expect(result.output).toBe('local-check-output')
    expect(calls.settled).toEqual(['kept'])
    expect(calls.sends).toBe(0)
    expect(calls.probes).toBe(0)
    expect(calls.locals).toBe(1)
    expect(calls.errors).toEqual([])
  })

  it('moves across separators', async () => {
    const { result, calls } = await routeOnDevices({
      links: [linkFor(checksOffer(), 'C:/work/repo')],
      send: {
        admission: 'admitted',
        result: { runId: 'run-1', exitCode: 0, output: 'device-check-output', location: 'paired' },
      },
      cwd: String.raw`C:\work\repo`,
    })
    expect(result.output).toBe('device-check-output')
    expect(calls.settled).toEqual(['admitted'])
    expect(calls.errors).toEqual([])
  })
})

describe('teams join completion', () => {
  const disposers: (() => void)[] = []
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
  })

  it('registers the binding once the teams wiring lands', async () => {
    expect(hasResourceRunnerRoutes()).toBe(false)
    expect(resourceRunnerRoutesJoin.isComplete).toBe(false)
    const errors: unknown[] = []
    disposers.push(
      configureResources({
        inspect: () => ({}),
        onError: (error?: unknown) => {
          errors.push(error)
        },
      }),
    )
    const runtime = createTeamRunnersRuntime(EN, 'en')
    const router = await runtime.createResourceRouting({
      headless: false,
      hasTarget: () => false,
      devicesEnabled: () => true,
      deviceLinks: () => [],
      isHeavy: () => true,
      phase: () => 'queued',
      isApproved: () => false,
      claim: () => true,
      settle: () => undefined,
      ask: () => Promise.resolve(false),
      deviceAsk: () => Promise.resolve(false),
      row: () => undefined,
      deviceRow: () => undefined,
      notice: () => undefined,
      deviceNotice: () => undefined,
      traffic: () => undefined,
      deviceTraffic: () => undefined,
      deviceSend: () => Promise.resolve({ admission: 'refused' }),
      onError: (error) => {
        errors.push(error)
      },
    })
    try {
      expect(resourceRunnerRoutesJoin.isComplete).toBe(true)
      expect(hasResourceRunnerRoutes()).toBe(true)
    } finally {
      router.dispose()
      resourceRunnerRoutesJoin.isComplete = false
    }
    expect(hasResourceRunnerRoutes()).toBe(false)
    expect(errors).toEqual([])
  })
})

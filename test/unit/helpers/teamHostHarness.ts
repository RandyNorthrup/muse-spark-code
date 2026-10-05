// A compact ModelApiHost harness for lane T's tests: the real host against
// the fake Model API, with the raw `POST /responses` bodies recorded,
// deterministic ids (`gen-N`) and a fixed clock. The team seams (decision
// source, roster data, runner, in-place flag) are injected per test; without
// them every conversation is single-model, exactly as today.

import type { PaidFeature } from '../../../src/shared/constants'
import { ModelApiClient } from '../../../src/core/backends/modelapi/client'
import {
  ModelApiHost,
  type ModelApiHostDeps,
  ModelApiSession,
} from '../../../src/core/backends/modelapi/ModelApiHost'
import type {
  TeamDecisionSource,
  TeamRosterLive,
  TeamStableRole,
  TeamToolRunner,
} from '../../../src/core/team/teamSeams'
import { FAKE_MODEL_API_ACCOUNT_ID, fakeModelApi, fakeModelApiClientSettings } from './fakeModelApi'
import type { FakeModelApi } from './fakeModelApi'
import { memoryContextIo } from './fakeContextIo'
import { type memorySessionStore } from './fakeSessionStore'
import { memoryStoreOver } from './fakeMemoryIo'
import { memoryToolIo } from './fakeToolIo'
import { FakeLogOutputChannel } from './fakes'
import { watchSessionTurns } from './sessionTurns'

export const TEAM_TEST_ROOT = '/ws'
export const TEAM_TEST_MODEL = 'muse-spark-1.3'

export interface TeamHostHarness {
  readonly host: ModelApiHost
  readonly api: FakeModelApi
  /** The raw `POST /responses` bodies, in order. */
  readonly rawBodies: string[]
  /** How often the host read the team decision source. */
  readonly sourceReads: () => number
  readonly startSession: (
    approvalMode?: string,
  ) => Promise<{ session: ModelApiSession; turnDone: () => Promise<void> }>
}

export function teamHostHarness(
  options: {
    files?: Record<string, string>
    paid?: readonly PaidFeature[]
    teamSource?: () => TeamDecisionSource | undefined
    roster?: readonly TeamStableRole[]
    live?: TeamRosterLive
    runner?: TeamToolRunner
    isTeamInPlaceActive?: () => boolean
    takeTeamChanges?: ModelApiHostDeps['takeTeamChanges']
    store?: ReturnType<typeof memorySessionStore>
    mcpServers?: ModelApiHostDeps['mcpServers']
  } = {},
): TeamHostHarness {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const rawBodies: string[] = []
  const recordingFetch: typeof fetch = async (input, init) => {
    let raw: string | undefined
    if (typeof init?.body === 'string') {
      raw = init.body
    } else if (input instanceof Request) {
      raw = await input.clone().text()
    }
    const url = input instanceof Request ? input.url : String(input)
    if (raw !== undefined && url.endsWith('/responses')) {
      rawBodies.push(raw)
    }
    return await api.fetch(input, init)
  }
  const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: recordingFetch })
  const io = memoryToolIo(options.files ?? {}, TEAM_TEST_ROOT)
  let ids = 0
  let clock = Date.parse('2026-10-04T12:00:00.000Z')
  let reads = 0
  const host = new ModelApiHost({
    client,
    workspaceRoot: TEAM_TEST_ROOT,
    platform: 'linux',
    io,
    contextIo: memoryContextIo(io.files),
    newId: () => {
      ids += 1
      return `gen-${String(ids)}`
    },
    now: () => {
      clock += 1000
      return clock
    },
    log,
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    isWorkspaceTrusted: () => true,
    isConfidentialWorkspace: () => false,
    confirmContributorModel: () => Promise.resolve(false),
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    ...(options.store !== undefined && { store: options.store }),
    ...(options.mcpServers !== undefined && { mcpServers: options.mcpServers }),
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    isPaidFeatureOn: (feature) => options.paid?.includes(feature) === true,
    notePaidUse: () => undefined,
    allowsPaidUse: () => Promise.resolve(true),
    isPaidUseRemembered: () => false,
    noteSubagentUsage: () => undefined,
    noteReviewerUsage: () => undefined,
    promptCacheRetention: () => 'in_memory',
    sessionBudgetUsd: () => 0,
    showReplyUsage: () => false,
    loadHooks: () => Promise.resolve([]),
    memory: memoryStoreOver(io.files, { platform: 'linux' }).store,
    ...(options.teamSource !== undefined && {
      teamDecisionSource: () => {
        reads += 1
        return options.teamSource?.()
      },
    }),
    ...((options.roster !== undefined || options.runner !== undefined) && {
      teamRosterData: () => ({
        stable: [...(options.roster ?? [])],
        ...(options.live !== undefined && { live: options.live }),
      }),
    }),
    ...(options.runner !== undefined && { teamRunner: options.runner }),
    ...(options.takeTeamChanges !== undefined && { takeTeamChanges: options.takeTeamChanges }),
    ...(options.isTeamInPlaceActive !== undefined && {
      isTeamInPlaceActive: options.isTeamInPlaceActive,
    }),
  } satisfies ModelApiHostDeps)
  return {
    host,
    api,
    rawBodies,
    sourceReads: () => reads,
    startSession: async (approvalMode = 'promptUnmatched') => {
      const session = await host.startSession({
        workspaceRoot: TEAM_TEST_ROOT,
        modelId: TEAM_TEST_MODEL,
        approvalMode,
      })
      if (!(session instanceof ModelApiSession)) throw new Error('Expected a Model API session')
      return { session, ...watchSessionTurns(session) }
    },
  }
}

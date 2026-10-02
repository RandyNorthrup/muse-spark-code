// A `ModelApiHost`'s dependencies over the fake Model API and an in-memory
// workspace: trusted, nothing paid or allowed, no personal skills or memory,
// ids and a clock that count up. The host suites spread it and change what
// they test.

import type { ModelApiClient } from '../../../src/core/backends/modelapi/client'
import type { ModelApiHostDeps } from '../../../src/core/backends/modelapi/ModelApiHost'
import type { CoreLogger } from '../../../src/core/logging'
import { memoryContextIo } from './fakeContextIo'
import { FAKE_MODEL_API_ACCOUNT_ID } from './fakeModelApi'
import type { MemoryToolIo } from './fakeToolIo'

// Where the counting clock starts, far from 0 so a stamp is never falsy.
const CLOCK_START_MS = 1_000_000
const CLOCK_STEP_MS = 1000

export function fakeModelApiHostDeps(base: {
  readonly client: ModelApiClient
  readonly workspaceRoot: string
  readonly io: MemoryToolIo
  readonly log: CoreLogger
}): ModelApiHostDeps {
  let ids = 0
  let clock = CLOCK_START_MS
  return {
    client: base.client,
    workspaceRoot: base.workspaceRoot,
    platform: 'linux',
    io: base.io,
    contextIo: memoryContextIo(base.io.files),
    newId: () => {
      ids += 1
      return `id${String(ids)}`
    },
    now: () => {
      clock += CLOCK_STEP_MS
      return clock
    },
    log: base.log,
    personalSkillsRoot: undefined,
    isWorkspaceTrusted: () => true,
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    isPaidFeatureOn: () => false,
    notePaidUse: () => undefined,
    promptCacheRetention: () => 'in_memory',
    // No session budget, no reply usage line (M82).
    sessionBudgetUsd: () => 0,
    showReplyUsage: () => false,
    allowsPaidUse: () => Promise.resolve(false),
    isPaidUseRemembered: () => false,
    noteSubagentUsage: () => undefined,
    noteReviewerUsage: () => undefined,
    memory: undefined,
  }
}

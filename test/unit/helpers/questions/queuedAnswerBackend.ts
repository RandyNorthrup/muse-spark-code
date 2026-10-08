import {
  ModelApiHost,
  type ModelApiHostDeps,
} from '../../../../src/core/backends/modelapi/ModelApiHost'
import type { CoreLogger } from '../../../../src/core/logging'
import { FAKE_MODEL_API_ACCOUNT_ID, fakeModelApi, fakeModelApiClient } from '../fakeModelApi'
import { memoryContextIo } from '../fakeContextIo'
import { memoryToolIo } from '../fakeToolIo'
import { Usd } from '../../../../src/shared/usd'

/** Fake HTTP and tools, real Model API session; shared by SDK and process-kill tests. */
export function queuedAnswerBackend(
  cwd: string,
  log: CoreLogger,
  hooks: Pick<ModelApiHostDeps, 'loadHooks' | 'admitResponseAttempt'> = {},
) {
  const api = fakeModelApi()
  const io = memoryToolIo({}, cwd)
  let ids = 0
  const host = new ModelApiHost({
    client: fakeModelApiClient(api, log),
    workspaceRoot: cwd,
    platform: process.platform,
    io,
    contextIo: memoryContextIo(io.files),
    newId: () => `id-${String(++ids)}`,
    now: () => Date.now(),
    log,
    isWorkspaceTrusted: () => true,
    personalSkillsRoot: undefined,
    memory: undefined,
    personalAgentsRoot: undefined,
    isConfidentialWorkspace: () => false,
    confirmContributorModel: () => Promise.resolve(false),
    promptCacheRetention: () => 'in_memory',
    sessionBudgetUsd: () => Usd.from(0).toAmount(),
    showReplyUsage: () => false,
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    allowsPaidUse: () => Promise.resolve(false),
    isPaidUseRemembered: () => false,
    noteSubagentUsage: () => undefined,
    noteReviewerUsage: () => undefined,
    isPaidFeatureOn: () => false,
    notePaidUse: () => undefined,
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    ...hooks,
  })

  return { api, io, host }
}

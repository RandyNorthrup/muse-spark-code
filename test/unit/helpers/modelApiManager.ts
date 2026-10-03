// A Model API backend manager's dependencies on the fake Model API (M7,
// M57): the key stored, no waits, no tool, hook, store or memory unless the
// test gives one, and the bundle the test names (the source module, a
// dist/modelApi.js it built, or the one the integration run's VS Code has).
// No vitest here: the integration tests use it too.

import type { ModelApiBackendManagerDeps } from '../../../src/host/backend/modelApiBackendManager'
import type { Logger } from '../../../src/host/logger'
import { memoryContextIo } from './fakeContextIo'
import type { FakeModelApi } from './fakeModelApi'
import { disabledPaidFeatures } from './fakePaidFeatures'
import { noopToolIo } from './fakeToolIo'

export function fakeManagerDeps(
  api: FakeModelApi,
  log: Logger,
  given: Partial<ModelApiBackendManagerDeps> &
    Pick<ModelApiBackendManagerDeps, 'workspaceRoot' | 'bundlePath'>,
): ModelApiBackendManagerDeps {
  return {
    log,
    getApiKey: () => Promise.resolve('LLM|1|secret'),
    io: noopToolIo,
    contextIo: memoryContextIo(new Map()),
    fetch: api.fetch,
    newId: () => 'id',
    now: () => 0,
    sleep: () => Promise.resolve(),
    random: () => 0,
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    isWorkspaceTrusted: () => true,
    isConfidentialWorkspace: () => false,
    confirmContributorModel: () => Promise.resolve(false),
    store: undefined,
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    ...disabledPaidFeatures,
    promptCacheRetention: () => '24h',
    hookSettingsPath: '/cfg/muse/settings.json',
    isHooksEnabled: () => false,
    memory: undefined,
    ...given,
  }
}

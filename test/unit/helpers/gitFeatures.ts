import type { GitFeaturesDeps } from '../../../src/host/git/gitWindow'
import { WindowHold, WorktreeRegistry } from '../../../src/host/git/worktreeRegistry'
import { memoryMemento } from './fakeGit'
import { FakeLogOutputChannel } from './fakes'

/** No git runs where these deps are used. */
function unused(): Promise<never> {
  return Promise.reject(new Error('not in this test'))
}

/** Activation's primitives as `createGitFeatures` takes them, over `fetch`. */
export function gitFeaturesDeps(fetch: GitFeaturesDeps['fetch'] = unused): GitFeaturesDeps {
  return {
    workspaceRoot: '/repo',
    storageRoot: '/storage',
    hold: new WindowHold(undefined),
    registry: new WorktreeRegistry(memoryMemento(), 'linux', () => true),
    workspaceState: memoryMemento(),
    fetch,
    userAgent: 'muse-spark-code/test',
    runGit: unused,
    gitProcess: unused,
    env: {},
    isCurrent: () => true,
    admit: (start) => start(),
    restartBackends: () => Promise.resolve(),
    holdReleased: () => undefined,
    signal: new AbortController().signal,
    log: new FakeLogOutputChannel(),
  }
}

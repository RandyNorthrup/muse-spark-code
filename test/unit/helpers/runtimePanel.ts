import { createRuntimeBackend } from '../../../src/runtime/backends'
import { memorySecrets } from './fakes'

/** Both panel fixtures prohibit external network/Git and use memory-only synthetic credentials. */
export function fakePanelRuntime(
  input: Pick<
    Parameters<typeof createRuntimeBackend>[0],
    'options' | 'distDir' | 'homeDir' | 'runGit' | 'log'
  >,
) {
  return createRuntimeBackend({
    ...input,
    version: 'fake',
    platform: process.platform,
    env: {},
    secrets: memorySecrets(),
    fetch: () => Promise.reject(new Error('fake refuses network')),
    sleep: () => Promise.resolve(),
  })
}

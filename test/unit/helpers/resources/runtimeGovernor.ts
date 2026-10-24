// The governor configured as the runtime process configures it for its
// commands (main.ts's resourcesFor → configureResources): its registry
// under the suite's own root, the created-path helper the governor shells
// to on each platform (built from source on Linux; the repository's native
// tree elsewhere, where the governor's bundled default would read
// src/core/native), and the Windows job helpers. Suites whose code starts
// processes through the governed launch are admitted here, for real.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { configureResources } from '../../../../src/core/resources/admission'
import {
  createdPathCommands,
  flushResourceHistory,
} from '../../../../src/core/resources/resourceGovernorEntry'
import { runtimeWindowsJob } from '../../../../src/runtime/resources/jobs'
import { buildLinuxHelper } from '../../../../scripts/build-linux-helper.mjs'

/**
Registers the file's hooks: the governor configured before its cases and
disposed after them, where `isNeeded` (the platforms its cases launch on).
*/
export function useRuntimeGovernor(prefix: string, isNeeded: boolean): void {
  const state: { governor?: RuntimeGovernor } = {}
  beforeAll(async () => {
    if (isNeeded) state.governor = await configureRuntimeGovernor(prefix)
  })
  afterAll(async () => {
    await state.governor?.dispose()
  })
}

export interface RuntimeGovernor {
  /** Unconfigures admission, settles the history write, removes the root. */
  readonly dispose: () => Promise<void>
}

export async function configureRuntimeGovernor(prefix: string): Promise<RuntimeGovernor> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  const windowsJob = runtimeWindowsJob(root, process.cwd())
  let commands: (args: readonly string[]) => Promise<string>
  if (process.platform === 'linux') {
    buildLinuxHelper(path.join(root, 'linux', process.arch))
    commands = createdPathCommands(root, undefined)
  } else {
    commands = createdPathCommands(path.resolve('native'), windowsJob)
  }
  const unconfigure = configureResources({
    registryFile: path.join(root, 'resource-created', 'registry.json'),
    createdDirectories: commands,
    inspect: () => ({}),
    onError: () => undefined,
    windowsJob,
  })
  // The job helpers compile on first use, admitted through the governor just
  // configured: built here, in the suite's hook, never inside a test case.
  if (process.platform === 'win32' && (await windowsJob()) === undefined) {
    unconfigure()
    throw new Error('the Windows job helpers did not build')
  }
  return {
    dispose: async () => {
      // Disposal flushes the governor's history after it returns; settle
      // that write before removing the root its registry lives under.
      unconfigure()
      await flushResourceHistory()
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
}

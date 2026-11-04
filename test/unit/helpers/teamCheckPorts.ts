// The process ports a person's check runs through, over a real repository: the real lifetime with
// its container on this system, and on Windows the real job. For suites that must not depend on a
// real `muse`, which none of this reaches.
import path from 'node:path'
import { runProgram } from '../../../src/host/processTree'
import { createNativeTeamProcessDriver } from '../../../src/host/team/processLifetime'
import {
  createProcessTeamPorts,
  type ProcessTeamPorts,
} from '../../../src/host/team/teamProcessWorkers'
import type { CheckCommandSetting } from '../../../src/shared/constants'
import { readJobSource } from './jobSource'
import { silentCoreLog } from './memoryLogs'
import { landingRunGit } from './teamLandingFixture'

const SYSTEM_ROOT = process.env['SystemRoot']

export function realCheckPorts(input: {
  /** Scratch: the ports' storage, journal and job go under it. */
  readonly root: string
  readonly repo: string
  readonly checks: () => readonly CheckCommandSetting[]
  readonly setupCommand?: string
}): ProcessTeamPorts {
  return createProcessTeamPorts({
    repositoryRoot: () => input.repo,
    storageRoot: path.join(input.root, 'ports'),
    journalStorageDirectory: path.join(input.root, 'journal'),
    platform: process.platform,
    isTrusted: () => true,
    extensionVersion: '0.0.0-test',
    resolveMuseServe: () => undefined,
    isContributorMode: () => false,
    checks: input.checks,
    checkSetup: () => ({ setupCommand: input.setupCommand ?? '', cacheKey: 'check-ports' }),
    baseEnv: () => process.env,
    pathEntries: () => [],
    // The product compiles the job's helper under its resource host; a bare test process has
    // none, so the real execFile runner compiles it, as helpers/shellJobBuild.ts does.
    ...(process.platform === 'win32' &&
      SYSTEM_ROOT !== undefined && {
        windows: {
          storageDir: path.join(input.root, 'job'),
          systemRoot: SYSTEM_ROOT,
          readJobSource,
          run: runProgram,
          log: () => undefined,
        },
      }),
    runGit: landingRunGit,
    now: () => Date.now(),
    log: silentCoreLog(),
  })
}

/** Whether this system's container can prove a command's whole tree ended: asked of the real driver. */
export async function doesSystemProveEnds(): Promise<boolean> {
  if (process.platform === 'win32') return true
  const driver = await createNativeTeamProcessDriver({ killGraceMs: 1000 })
  return driver.provesEnds
}

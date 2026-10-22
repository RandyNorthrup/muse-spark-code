// Pull-request checkout git through the governed launcher (M123, RLM123):
// with a real configured governor, `nodeGitProcesses` admits each launch
// and runs the caller's last check in the spawn turn; a refusal surfaces
// the gate's own reason. Real git in a real temporary folder, through the
// product's own Windows job on win32. The unconfigured direct route is
// covered by nativeProcessDefaults.test.ts.
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NO_WORKSPACE } from '../../src/core/executables'
import { resolveExecutable, workspaceChildEnvironment } from '../../src/core/execGuard'
import { configureResources, loadResourceWindow } from '../../src/core/resources/admission'
import { nodeGitProcesses } from '../../src/runtime/panel/pullRequests/checkout'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { GIT_OUTPUT_MAX_BYTES, GIT_WORKTREE_TIMEOUT_MS } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

/** The host's git, resolved absolutely: the only git this test runs. */
function hostGitPath(): string {
  const found = resolveExecutable('git', {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
    scope: { noWorkspace: NO_WORKSPACE, realpath: realpathSync },
  })
  if (found === undefined) throw new Error('the tests need git on PATH')
  return found
}

describe('governed checkout git', () => {
  let root = ''
  let gitPath = ''
  let disposeResources: (() => void) | undefined

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-governed-git-')))
    gitPath = hostGitPath()
    // The governor, configured as the host does: admission answers, so the
    // checkout takes the governed route instead of the direct one.
    disposeResources = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      ...(process.platform === 'win32' && {
        windowsJob: runtimeWindowsJob(
          mkdtempSync(path.join(tmpdir(), 'governed-git-jobs-')),
          path.resolve('.'),
        ),
      }),
    })
    if (process.platform === 'win32' && (await loadResourceWindow()) === undefined)
      throw new Error('the Windows job helpers did not build')
  })

  afterAll(async () => {
    disposeResources?.()
    await removeFolder(root)
  })

  function runOptions(gate: () => void) {
    return {
      cwd: root,
      env: workspaceChildEnvironment(process.platform, process.env, {
        workspaceRoot: root,
        realpath: realpathSync,
      }),
      signal: new AbortController().signal,
      // The product's own checkout deadline: the test waits as checkout does.
      timeout: GIT_WORKTREE_TIMEOUT_MS,
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      beforeSpawn: gate,
    }
  }

  it('admits the run and checks the gate in the spawn turn', async () => {
    let gateRuns = 0
    const ran = await nodeGitProcesses.run(
      gitPath,
      ['--version'],
      runOptions(() => {
        gateRuns += 1
      }),
    )
    expect(ran).toContain('git version')
    // Admission was configured, so the governed route ran, not the direct
    // one; and the launcher ran the gate in the spawn turn (again at
    // Windows GO, so at least once).
    expect(await loadResourceWindow()).not.toBeUndefined()
    expect(gateRuns).toBeGreaterThanOrEqual(1)
  })

  it('a refused gate surfaces its own reason, not a spawn failure', async () => {
    await expect(
      nodeGitProcesses.run(
        gitPath,
        ['--version'],
        runOptions(() => {
          throw new Error('trust lost for the test checkout')
        }),
      ),
    ).rejects.toThrow('trust lost for the test checkout')
  })

  it('admits the batch start and checks the gate in the spawn turn', async () => {
    let gateRuns = 0
    const child = await nodeGitProcesses.start(gitPath, ['--version'], {
      ...runOptions(() => {
        gateRuns += 1
      }),
      detached: false,
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    const exit = await new Promise<number | null>((resolve) => {
      child.once('exit', resolve)
    })
    expect(exit).toBe(0)
    expect(Buffer.concat(chunks).toString('utf8')).toContain('git version')
    expect(await loadResourceWindow()).not.toBeUndefined()
    expect(gateRuns).toBeGreaterThanOrEqual(1)
  })
})

import path from 'node:path'
import { workspaceChildEnvironment } from '../../src/core/execGuard'
import { realpathSync } from 'node:fs'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WORKER_NATIVE_IO } from '../../src/core/team/workers/workerFence'
import { nodeGitProcesses } from '../../src/runtime/panel/pullRequests/checkout'
import { removeFolder } from './helpers/temporaryFolders'

// The two defaults spawnInventory profiles as test-only: each runs here
// against the real process and the real file system, by name.
const GIT_TIMEOUT_MS = 5000
const GIT_MAX_BUFFER = 1_000_000

describe('native process defaults', () => {
  let root = ''
  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-native-defaults-')))
  })
  afterAll(() => removeFolder(root))

  it('runs git to completion through nodeGitProcesses.run and .start', async () => {
    let gateRuns = 0
    const options = {
      cwd: root,
      // The real guarded child environment for the run's directory: git
      // still resolves, but never to a program planted under it.
      env: workspaceChildEnvironment(process.platform, process.env, {
        workspaceRoot: root,
        realpath: realpathSync,
      }),
      signal: new AbortController().signal,
      timeout: GIT_TIMEOUT_MS,
      // The checkout's synchronous last check: the direct route runs it
      // immediately before each launch; here it always allows.
      beforeSpawn: () => {
        gateRuns += 1
      },
    }
    const ran = await nodeGitProcesses.run('git', ['--version'], {
      ...options,
      maxBuffer: GIT_MAX_BUFFER,
    })
    expect(ran).toContain('git version')

    const child = await nodeGitProcesses.start('git', ['--version'], {
      ...options,
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
    expect(gateRuns).toBeGreaterThanOrEqual(1)
  })

  it('opens, identifies and reads a real file through WORKER_NATIVE_IO.openFile', async () => {
    const openFile = WORKER_NATIVE_IO.openFile
    if (openFile === undefined) throw new Error('WORKER_NATIVE_IO must carry openFile')
    const file = path.join(root, 'held.txt')
    await writeFile(file, 'held bytes')
    const handle = await openFile(file, false)
    try {
      const identified = await handle.identify()
      expect(identified.absolute).toBe(await realpath(file))
      expect(identified.identity).toBe(await WORKER_NATIVE_IO.pathIdentity(file))
      expect(await handle.read(100)).toBe('held bytes')
    } finally {
      await handle.close()
    }
  })
})

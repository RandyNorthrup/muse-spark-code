// What a shell that never started, and one that did, leave in the checkpoint
// store (M72, PLAN.md D51): a missing interpreter launched nothing, so it must
// not record native uncertainty; a real launched command's descendants are
// never proven stopped by the runner, so it still must. Real Git, the real
// store and the real native adapter over a real (or really missing) shell.
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createToolIo } from '../../src/host/backend/toolIo'
import { withCheckpointCopies } from '../../src/host/checkpoints/checkpointHost'
import {
  CHECKPOINT_ACTIVITY_PREFIX,
  CHECKPOINT_NATIVE_WINDOW,
  SHELL_DEFAULT_TIMEOUT_MS,
} from '../../src/shared/constants'
import {
  checkpointPort,
  harness,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

function nativeIo(
  layout: Pick<Parameters<typeof createToolIo>[0], 'platform' | 'systemRoot' | 'env'>,
) {
  return createToolIo({
    ...layout,
    listFiles: () => Promise.resolve([]),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
  })
}

async function presence(storage: string): Promise<string> {
  const names = await readdir(path.join(storage, 'windows'))
  return await read(storage, `windows/${names[0] ?? ''}`)
}

describe('the checkpoint wrapper over a shell that never started (M72)', () => {
  it.each(['a POSIX layout with no shell on PATH', 'a Windows layout without PowerShell'] as const)(
    'keeps the failure and records no native uncertainty for %s',
    async (layout) => {
      const h = await harness()
      const isPosix = layout === 'a POSIX layout with no shell on PATH'
      const missing = nativeIo({
        platform: isPosix ? 'linux' : 'win32',
        systemRoot: isPosix ? undefined : path.join(h.root, 'no-such-windows'),
        env: () => (isPosix ? { PATH: '' } : {}),
      })
      const io = withCheckpointCopies(missing, checkpointPort(h))
      const result = await io.runShell('echo hi', h.root, SHELL_DEFAULT_TIMEOUT_MS)
      expect(result.exitCode).toBeNull()
      expect(result.stderr).not.toBe('')
      expect(result.isCancelled).toBe(false)
      expect(h.store.isNativeUnsafe).toBe(false)
      const text = await presence(h.storage)
      expect(text).not.toContain(CHECKPOINT_ACTIVITY_PREFIX)
      expect(text).not.toContain(CHECKPOINT_NATIVE_WINDOW)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'still records native uncertainty after a real command that launched and exited normally',
    async () => {
      const h = await harness()
      const real = nativeIo({
        platform: process.platform,
        systemRoot: process.env['SystemRoot'],
        // The host's whole environment, as the shell tool gets it: PATH alone
        // hid PSModuleAnalysisCachePath on GitHub's runner and made
        // `Write-Output` analyse every installed module first (23 to 39 s).
        env: () => process.env,
      })
      const io = withCheckpointCopies(real, checkpointPort(h))
      const command = process.platform === 'win32' ? 'Write-Output launched' : 'printf launched'
      const result = await io.runShell(command, h.root, SHELL_DEFAULT_TIMEOUT_MS)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('launched')
      expect(result.isWorkspaceShutdownProven).toBeUndefined()
      expect(h.store.isNativeUnsafe).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

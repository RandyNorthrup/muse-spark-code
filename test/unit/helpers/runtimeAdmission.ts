import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import { lazyRuntimeResources } from '../../../src/runtime/resources/load'
import { createResources } from '../../../src/runtime/resources/entry'
import { resourceWindowsJob } from '../../../src/core/resources/admission'
import { removeFolder } from './temporaryFolders'

/** Real native runtime binding; compilation belongs to shared suite setup. */
export async function fixtureRuntimeAdmission() {
  const parent = path.join(tmpdir(), 'l-SPAWN017B')
  await mkdir(parent, { recursive: true })
  const machineDir = await mkdtemp(path.join(parent, 'runtime-'))
  const resources = lazyRuntimeResources({
    distDir: path.resolve('dist'),
    machineDir,
    sleep: () => Promise.resolve(),
    overrides: { enabled: false },
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onError: vi.fn(),
    loadBundle: () => ({ createResources }),
  })
  if (process.platform === 'win32') {
    const job = await resourceWindowsJob()
    if (job === undefined) throw new Error('Native runtime launch unavailable')
  }
  return async () => {
    resources.dispose()
    await removeFolder(machineDir)
  }
}

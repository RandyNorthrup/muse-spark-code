// The real Windows vault helper for the suites that need it: governed
// launch with the job helpers recording it, built in a temp storage dir.
// Shared by the pipe-start and DPAPI suites for the duplication gate.
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { configureResources } from '../../../src/core/resources/admission'
import { windowsPipeExecutable } from '../../../src/host/vault/slots/windowsVaultBuild'
import { runtimeWindowsJob } from '../../../src/runtime/resources/jobs'
import type { WindowsVaultExecutable } from '../../../src/runtime/vault/slots/windowsVaultTransport'

export interface WindowsVaultHelper {
  readonly root: string
  readonly helper: WindowsVaultExecutable
  dispose(): void
}

export async function buildWindowsVaultHelper(prefix: string): Promise<WindowsVaultHelper> {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), prefix))
  // Not made here: the build makes its storage folder on first use, and
  // the pipe-start suite proves the helper lands there, never in temp.
  const storageDir = path.join(root, 'data', 'vault', 'helpers')
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined || systemRoot === '') throw new Error('SystemRoot is missing')
  const windowsJob = runtimeWindowsJob(path.join(root, 'jobs'), path.resolve('.'))
  const dispose = configureResources({
    inspect: () => ({}),
    onError: () => undefined,
    windowsJob,
  })
  // The job helpers compile on first governed use: prepare them here, in
  // the hook's budget, so each case below is a launch and never a build.
  if ((await windowsJob()) === undefined) throw new Error('the Windows job helpers did not build')
  const helper = await windowsPipeExecutable({
    storageDir,
    systemRoot,
    readSlotSource: () => readFile(path.resolve('native/windows/MuseSparkVault.cs'), 'utf8'),
    readPipeSource: () => readFile(path.resolve('native/windows/MuseSparkVaultPipe.cs'), 'utf8'),
  })
  return { root, helper, dispose }
}

export async function disposeWindowsVaultHelper(built: WindowsVaultHelper): Promise<void> {
  built.dispose()
  await rm(built.root, { recursive: true, force: true })
}

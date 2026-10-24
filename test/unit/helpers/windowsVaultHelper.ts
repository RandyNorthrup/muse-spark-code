// The real Windows vault helpers for the suites that need them: governed
// launch with the job helpers recording it, built in a temp storage dir.
// The pipe helper (the broker's relay) serves the pipe-start suite; the slot
// helper (the one that seals keys, as the client platform builds it) serves
// the DPAPI suite. Shared for the duplication gate.
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { configureResources } from '../../../src/core/resources/admission'
import {
  windowsPipeExecutable,
  windowsVaultExecutable,
} from '../../../src/host/vault/slots/windowsVaultBuild'
import { runtimeWindowsJob } from '../../../src/runtime/resources/jobs'
import { WINDOWS_VAULT_SLOT_SOURCES } from '../../../src/runtime/vault/windowsClientPlatform'
import type { WindowsVaultExecutable } from '../../../src/runtime/vault/slots/windowsVaultTransport'

export interface WindowsVaultHelper {
  readonly root: string
  readonly helper: WindowsVaultExecutable
  dispose(): void
}

interface HelperBuild {
  readonly storageDir: string
  readonly systemRoot: string
}

async function buildHelper(
  prefix: string,
  compile: (build: HelperBuild) => Promise<WindowsVaultExecutable>,
): Promise<WindowsVaultHelper> {
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
  const helper = await compile({ storageDir, systemRoot })
  return { root, helper, dispose }
}

/** The broker's pipe helper: the slot source's path guard plus the pipe source. */
export async function buildWindowsVaultHelper(prefix: string): Promise<WindowsVaultHelper> {
  return await buildHelper(prefix, ({ storageDir, systemRoot }) =>
    windowsPipeExecutable({
      storageDir,
      systemRoot,
      readSlotSource: () => readFile(path.resolve('native/windows/MuseSparkVault.cs'), 'utf8'),
      readPipeSource: () => readFile(path.resolve('native/windows/MuseSparkVaultPipe.cs'), 'utf8'),
    }),
  )
}

/** The slot helper that seals keys, compiled from the sources the client platform joins. */
export async function buildWindowsVaultSlotHelper(prefix: string): Promise<WindowsVaultHelper> {
  return await buildHelper(prefix, async ({ storageDir, systemRoot }) => {
    const parts = await Promise.all(
      WINDOWS_VAULT_SLOT_SOURCES.map((name) => readFile(path.resolve(name), 'utf8')),
    )
    return await windowsVaultExecutable({
      storageDir,
      systemRoot,
      readSource: () => Promise.resolve(parts.join('\n')),
    })
  })
}

export async function disposeWindowsVaultHelper(built: WindowsVaultHelper): Promise<void> {
  built.dispose()
  await rm(built.root, { recursive: true, force: true })
}

// The Windows vault broker's end-to-end fixture, shared by the suites that
// drive the real broker on Windows: the real client platform builds both
// helpers, launches the real installed broker entry (bundled exactly as the
// packages lay it out) and dials its pipe. Nothing is invented: the pipe
// name, the trust and every answer come from the helpers and the broker.
// The host ids are 32 hex characters, minted the way the panel mints them
// (randomBytes(16).toString('hex')): the registrar parses them as such,
// and shorter names throw before connect.

import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { vaultClientPlatform } from '../../../../src/runtime/vault/clientPlatform'
import type { VaultClientPlatform } from '../../../../src/runtime/vault/clientPlatform'
import { VaultBrokerProcess } from '../../../../src/host/vault/brokerProcess'
import { configureResources } from '../../../../src/core/resources/admission'
import { runtimeWindowsJob } from '../../../../src/runtime/resources/jobs'
import { vaultBrokerLockSchema } from '../../../../src/shared/vaultProtocol'
import { expect, vi } from 'vitest'
import { processesNaming } from '../browserProcesses'
import { expectEnded, isRunning } from '../processes'
import { removeFolder } from '../temporaryFolders'

/** How long the fixture's own processes may take to end once stopped (a process table read is slow). */
const TEARDOWN_TIMEOUT_MS = 20_000

/** Every source the Windows package ships beside dist for the vault and the job helpers. */
const WINDOWS_SOURCES = [
  'MuseSparkJob.cs',
  'MuseSparkMcpJob.cs',
  'MuseSparkMcpLauncher.cs',
  'MuseSparkVault.cs',
  'MuseSparkVaultCng.cs',
  'MuseSparkVaultHello.cs',
  'MuseSparkVaultLock.cs',
  'MuseSparkVaultPipe.cs',
] as const

/** The installed entries, file for file: the broker requires its siblings from its own folder. */
const BROKER_ENTRIES: readonly (readonly [string, string])[] = [
  ['src/runtime/vault/vaultBrokerEntry.ts', 'vaultBroker.js'],
  ['src/core/resources/resourceGovernorEntry.ts', 'resourceGovernor.js'],
  ['src/runtime/vault/vaultRuntimeEntry.ts', 'vaultRuntime.js'],
  ['src/runtime/vault/brokerBindings.ts', 'vaultBrokerBindings.js'],
]

export interface WindowsBrokerFixture {
  readonly root: string
  /** The per-user data folder the client platform was given (the vault lives in its `vault/`). */
  readonly dataDir: string
  readonly hostId: string
  readonly hostSession: string
  readonly platform: VaultClientPlatform
  readonly broker: VaultBrokerProcess
  /** The panel's own connect (vaultPanelEntry's vaultConnection): one authenticated connection per call. */
  connect(): ReturnType<VaultBrokerProcess['connect']>
  /** Ends the broker this fixture started, its platform and the governor, then removes the folder. */
  dispose(): Promise<void>
}

/**
Stage the package layout, configure the governor as the extension host
configures it at activation and build the client platform (the helper
builds, with the person's own C# compiler, happen here).
*/
export async function startWindowsBrokerFixture(prefix: string): Promise<WindowsBrokerFixture> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  const dist = path.join(root, 'dist')
  // The client reads the slot and pipe sources beside dist exactly as the
  // package lays them out, and the broker reads the job helpers' sources
  // there, so the fixture stages those real sources.
  const sources = path.join(root, 'native', 'windows')
  await mkdir(sources, { recursive: true })
  for (const name of WINDOWS_SOURCES)
    await copyFile(path.resolve('native/windows', name), path.join(sources, name))
  await Promise.all(
    BROKER_ENTRIES.map(([entry, outfile]) =>
      build({
        entryPoints: [entry],
        outfile: path.join(dist, outfile),
        bundle: true,
        // This fixture stages the VSIX, which ships no keyring binding.
        // Bind that optional import to its own absent package entry: Node
        // must never walk up from an in-checkout TEMP into the developer's
        // node_modules and open the person's native rollback anchor.
        alias: {
          '@napi-rs/keyring': path.join(root, 'node_modules', '@napi-rs', 'keyring', 'index.js'),
        },
        external: [path.join(root, 'node_modules', '@napi-rs', 'keyring', 'index.js')],
        platform: 'node',
        format: 'cjs',
      }),
    ),
  )
  // The client side admits its helper builds and launches through the real
  // resource governor: Windows records each governed child through the job
  // helpers, built from the staged sources.
  const disposeAdmission = configureResources({
    inspect: () => ({}),
    onError: () => undefined,
    windowsJob: runtimeWindowsJob(path.join(root, 'jobs'), root),
  })
  const hostId = randomBytes(16).toString('hex')
  const hostSession = randomBytes(16).toString('hex')
  const dataDir = path.join(root, 'data')
  let platform: VaultClientPlatform
  try {
    platform = await vaultClientPlatform({ dataDir, distDir: dist, hostId, hostSession })
  } catch (error: unknown) {
    disposeAdmission()
    await removeFolder(root)
    throw error
  }
  const broker = new VaultBrokerProcess(platform.discovery, platform.process)
  return {
    root,
    dataDir,
    hostId,
    hostSession,
    platform,
    broker,
    connect: () => broker.connect(hostId, hostSession, platform.peers, platform.dial),
    dispose: async () => {
      platform.dispose?.()
      disposeAdmission()
      // The launched broker would idle out on its own, but Windows cannot
      // remove a running program's files: the broker the claim names ends
      // first, whether or not a connection to it ever succeeded (an orderly
      // shutdown already removed the claim), then every process still
      // running from this folder (the helpers the broker and the client
      // started, the job launchers), and only then does the folder go.
      const pid = await claimedBrokerPid(platform.discovery.lockFile)
      if (pid !== null && isRunning(pid)) {
        process.kill(pid)
        await expectEnded(pid)
      }
      const started = await processesNaming(root)
      for (const pid of started) if (isRunning(pid)) process.kill(pid)
      await vi.waitFor(
        async () => {
          expect(await processesNaming(root)).toEqual([])
        },
        { timeout: TEARDOWN_TIMEOUT_MS },
      )
      await removeFolder(root)
    },
  }
}

/** The process the broker claim names, or null once an orderly shutdown removed it. */
async function claimedBrokerPid(lockFile: string): Promise<number | null> {
  let raw: string
  try {
    raw = await readFile(lockFile, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  return vaultBrokerLockSchema.parse(JSON.parse(raw)).processId
}

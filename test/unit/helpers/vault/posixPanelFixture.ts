// The POSIX vault panel's end-to-end fixture, shared by the suites that
// drive the real broker on macOS and Linux: the real client platform builds
// the peer helper, launches the real installed broker entry (bundled exactly
// as the packages lay it out, with the macOS slot helper staged beside it)
// and dials its socket. Nothing is invented: the socket, the trust and every
// answer come from the helpers and the broker. The host ids are 32 hex
// characters, minted the way the panel mints them (randomBytes(16).
// toString('hex')): the registrar parses them as such, and shorter names
// throw before connect.

import { chmod, copyFile, mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { vaultClientPlatform } from '../../../../src/runtime/vault/clientPlatform'
import type { VaultClientPlatform } from '../../../../src/runtime/vault/clientPlatform'
import { VaultBrokerProcess } from '../../../../src/host/vault/brokerProcess'
import type { VaultBrokerLocation } from '../../../../src/core/vault/broker/discovery'
import { configureResources } from '../../../../src/core/resources/admission'
import { createdPathCommands } from '../../../../src/core/resources/resourceGovernorEntry'
import { darwinVaultSlotFile } from '../../../../src/shared/constants'
import { expectEnded, isRunning } from '../processes'
import { removeFolder } from '../temporaryFolders'
import { buildBrokerChildren } from './sessionBrokerBuild'
// The product's own bundle sharing (scripts/build.mjs): one process-wide
// admission state in dist/resourceAdmission.js and one core store in
// dist/vaultStore.js, required by every sibling instead of copied. A vault
// broker whose siblings each inline admission configures one copy and
// probes through another, which refuses as unconfigured.
import {
  sharedResourceAdmission,
  sharedVaultStore,
} from '../../../../scripts/lib/deferredBundles.mjs'

/** The installed entries, file for file: the broker requires its siblings from its own folder. */
const BROKER_ENTRIES: readonly (readonly [string, string])[] = [
  ['src/runtime/vault/vaultBrokerEntry.ts', 'vaultBroker.js'],
  ['src/core/resources/resourceGovernorEntry.ts', 'resourceGovernor.js'],
  ['src/runtime/vault/vaultRuntimeEntry.ts', 'vaultRuntime.js'],
  ['src/runtime/vault/brokerBindings.ts', 'vaultBrokerBindings.js'],
  ['src/core/resources/admissionEntry.ts', 'resourceAdmission.js'],
  ['src/runtime/vault/storeEntry.ts', 'vaultStore.js'],
]

export interface PosixPanelClient {
  /** The per-user data folder this client was given (the vault lives in its `vault/`). */
  readonly dataDir: string
  readonly hostId: string
  readonly hostSession: string
  readonly platform: VaultClientPlatform
  readonly broker: VaultBrokerProcess
  /** The panel's own connect (vaultPanelEntry's vaultConnection): one authenticated connection per call. */
  connect(): ReturnType<VaultBrokerProcess['connect']>
  /** Ends this client's broker and its admission; the folder goes with the fixture. */
  dispose(): Promise<void>
}

export interface PosixPanelFixture {
  readonly root: string
  /** Builds the real client platform over a fresh data folder, as an editor host does. */
  startClient(dataName: string): Promise<PosixPanelClient>
  /** Ends every client left running, then removes the folder. */
  dispose(): Promise<void>
}

/** Set to an unpacked .vsix's `extension/` folder to drive the packed broker and helpers. */
const PACKED_ROOT_ENV = 'MUSE_VAULT_PACKED_ROOT'

/**
Builds the install layout from source into `root`: the peer and created
helpers, the broker entries bundled as the package bundles them, and the
macOS slot helper `native/darwin/build.sh` produced.
*/
async function stageFromSource(root: string): Promise<void> {
  // The peer helper and the created helper beside the bundled governor,
  // exactly where the installed product resolves them.
  await buildBrokerChildren(root, [])
  // The product's own sharing: its vault bundles externalize the
  // admission state and the core store to their shared siblings, while each
  // sibling inlines its own entry (the build skips the entry itself, so no
  // sibling requires itself). The fixture mirrors that per bundle.
  const shared = [sharedResourceAdmission, sharedVaultStore]
  // The admission sibling inlines everything (the product's build skips the
  // entry itself by outfile; here any sharing plugin would make it require
  // itself). The store sibling shares only the admission state, like the
  // product's own vaultStore.js build does.
  const pluginsFor = (outfile: string): typeof shared => {
    if (outfile === 'resourceAdmission.js') return []
    return outfile === 'vaultStore.js' ? [sharedResourceAdmission] : shared
  }
  await Promise.all(
    BROKER_ENTRIES.map(([entry, outfile]) =>
      build({
        entryPoints: [entry],
        outfile: path.join(root, 'dist', outfile),
        bundle: true,
        external: ['@napi-rs/keyring'],
        plugins: pluginsFor(outfile),
        platform: 'node',
        format: 'cjs',
      }),
    ),
  )
  if (process.platform !== 'darwin') return
  const staged = path.join(root, 'dist', 'native', 'darwin')
  await mkdir(staged, { recursive: true })
  for (const arch of ['arm64', 'x64'] as const) {
    const name = darwinVaultSlotFile(arch)
    await copyFile(path.resolve('dist', 'native', 'darwin', name), path.join(staged, name))
    await chmod(path.join(staged, name), 0o755)
  }
}

/**
Stage the package layout: the peer and created helpers the real product
ships, the installed broker entries the real client platform launches, and
the macOS slot helper `native/darwin/build.sh` produces (the Secure Enclave
probe runs it; the install root carries it under dist like the package).
*/
export async function startPosixPanelFixture(prefix: string): Promise<PosixPanelFixture> {
  // Canonical spelling: macOS spells its temporary root through /var or
  // /tmp, both symlinks, and the store refuses symlink-spelled ancestors, so
  // the generated root resolves to its real path first (same directory).
  const scratch = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  // An unpacked package's `extension/` folder, when given, is the install
  // root instead: its own broker bundles and helpers run, never rebuilt and
  // never written to; every client's data stays in the scratch folder.
  const packed = process.env[PACKED_ROOT_ENV]
  const root = packed === undefined || packed === '' ? scratch : await realpath(packed)
  if (root === scratch) await stageFromSource(root)
  const clients: (() => Promise<void>)[] = []
  return {
    root,
    startClient: async (dataName: string): Promise<PosixPanelClient> => {
      const dataDir = path.join(scratch, dataName)
      // The installed host configures admission before any client launch;
      // this is that wiring (extension.ts), with only the created helper
      // rooted at the staged install layout: the bundled default spells
      // dist/../native, which from source would read src/core/native.
      const runDirectory = path.join(dataDir, 'client-run')
      const disposeAdmission = configureResources({
        registryFile: path.join(runDirectory, 'resource-created', 'registry.json'),
        inspect: () => ({}),
        onError: () => undefined,
        createdDirectories: createdPathCommands(path.join(root, 'native'), undefined),
      })
      const hostId = randomBytes(16).toString('hex')
      const hostSession = randomBytes(16).toString('hex')
      let platform: VaultClientPlatform
      try {
        // The real client platform: the broker inherits the editor host's
        // own environment (HOME, TMPDIR, XDG_RUNTIME_DIR where set), the
        // way VS Code's extension host hands it down.
        platform = await vaultClientPlatform({
          dataDir,
          distDir: path.join(root, 'dist'),
          hostId,
          hostSession,
        })
      } catch (error: unknown) {
        disposeAdmission()
        throw error
      }
      const broker = new VaultBrokerProcess(platform.discovery, platform.process)
      const dispose = async (): Promise<void> => {
        platform.dispose?.()
        disposeAdmission()
        // The handed-off broker belongs to no client and exposes no stop:
        // it ends here, whether or not a connection to it ever succeeded.
        // Discovery only: get() would launch a broker that never started.
        // The pids are tracked exactly (this rig cannot list processes).
        let location: VaultBrokerLocation | null
        try {
          location = await platform.discovery.discover((pid) => platform.process.identity(pid))
        } catch {
          // Best-effort teardown: a broker that never started has no process to stop.
          location = null
        }
        if (location === null || !isRunning(location.lock.processId)) return
        process.kill(location.lock.processId)
        await expectEnded(location.lock.processId)
      }
      clients.push(dispose)
      return {
        dataDir,
        hostId,
        hostSession,
        platform,
        broker,
        connect: () => broker.connect(hostId, hostSession, platform.peers, platform.dial),
        dispose,
      }
    },
    dispose: async () => {
      for (const dispose of clients.splice(0)) await dispose()
      await removeFolder(scratch)
    },
  }
}

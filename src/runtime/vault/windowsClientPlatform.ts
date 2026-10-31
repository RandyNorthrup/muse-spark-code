import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { isVaultFileMissing } from '../../core/vault/broker/files'
import { VaultBrokerDiscovery } from '../../core/vault/broker/discovery'
import { WindowsVaultPeerVerifier, type VaultProcessIdentity } from '../../core/vault/broker/peer'
import {
  isVaultPipeServerTrusted,
  windowsVaultPipeNameSchema,
} from '../../core/vault/broker/windowsPipe'
import { UI_TEXT, VAULT_BROKER_NATIVE_TIMEOUT_MS } from '../../shared/constants'
import type { VaultClientPlatform, VaultClientPlatformContext } from './clientPlatform'
import { isBrokerLockGone, launchSessionBroker, vaultInstallRoot } from './clientLaunch'
import {
  windowsPipeExecutable,
  windowsVaultExecutable,
} from '../../host/vault/slots/windowsVaultBuild'
import { startWindowsPipeFiles, windowsVaultPipeDial, type PipeRelay } from './windowsPipeRelay'
import { registerWindowsVaultHost, windowsProcessIdentity } from './windowsHost'
import { vaultBrokerDataDir } from './vaultStoreScope'

/** The pipe and slot sources every Windows package ships; the slot helper compiles as one unit. */
export const WINDOWS_VAULT_SLOT_SOURCES = [
  'native/windows/MuseSparkVault.cs',
  'native/windows/MuseSparkVaultCng.cs',
  'native/windows/MuseSparkVaultHello.cs',
  'native/windows/MuseSparkVaultLock.cs',
] as const
const PIPE_SOURCE = 'native/windows/MuseSparkVaultPipe.cs'

/** A built helper as the broker's launch payload names it (VaultBrokerLaunch). */
function launchHelper(helper: { file: string; sha256: string; powershell: string }) {
  return { file: helper.file, sha256: helper.sha256, powershell: helper.powershell }
}

/** Installed Windows vault client: builds both helpers at first use, then mirrors the POSIX flow. */
export async function windowsVaultClientPlatform(
  context: VaultClientPlatformContext,
): Promise<VaultClientPlatform> {
  if (process.platform !== 'win32') throw new Error(UI_TEXT.vault.brokerDisabled)
  const installRoot = vaultInstallRoot(context)
  const systemRoot = process.env['SystemRoot']
  if (!systemRoot) throw new Error(UI_TEXT.vault.noAccess)
  // Both helpers compile on the person's own machine at first vault use
  // (the user's compiler, cached by source digest): the pipe helper owns
  // the serve relay and the owner-only files, the slot helper seals.
  const storageDir = path.join(context.dataDir, 'vault', 'helpers')
  const slotParts = await Promise.all(
    WINDOWS_VAULT_SLOT_SOURCES.map((name) => readFile(path.join(installRoot, name), 'utf8')),
  )
  const slotSource = slotParts.join('\n')
  const slotHelper = await windowsVaultExecutable({
    storageDir,
    systemRoot,
    readSource: () => Promise.resolve(slotSource),
  })
  const pipeHelper = await windowsPipeExecutable({
    storageDir,
    systemRoot,
    readSlotSource: () => readFile(path.join(installRoot, WINDOWS_VAULT_SLOT_SOURCES[0]), 'utf8'),
    readPipeSource: () => readFile(path.join(installRoot, PIPE_SOURCE), 'utf8'),
  })
  const plainPipeHelper = {
    file: pipeHelper.file,
    sha256: pipeHelper.sha256,
    powershell: pipeHelper.powershell,
    guardSource: pipeHelper.guardSource,
  }
  const plainSlotHelper = {
    file: slotHelper.file,
    sha256: slotHelper.sha256,
    powershell: slotHelper.powershell,
    guardSource: slotHelper.guardSource,
  }
  // Files mode answers owner-only file and identity reads without owning a
  // pipe; the broker child owns the serve pipe from the same binary. The
  // client never rebuilds helpers either: integrity failures refuse.
  const pipeFiles = await startWindowsPipeFiles({
    ...plainPipeHelper,
    rebuild: () => Promise.reject(new Error(UI_TEXT.vault.noAccess)),
    report: () => {
      process.stderr.write('vault-slot-rebuild-refused\n')
    },
  })
  // Files mode owns no pipe, so no ready frame names the owner: every
  // identity answer carries the helper's own token user, the SID a serve
  // helper announces.
  let ownerSid: string
  try {
    const self = await pipeFiles.inspectProcess(process.pid)
    ownerSid = self.ownerSid
  } catch (error: unknown) {
    await pipeFiles.stop()
    throw error
  }
  const userSession = ownerSid
  const runDirectory = path.join(context.dataDir, 'vault', 'run')
  const relay: PipeRelay = pipeFiles.relay
  const identity = async (pid: number): Promise<VaultProcessIdentity> => {
    const found = await windowsProcessIdentity(relay, pid)
    // Discovery treats a proven-dead owner as absent, allowing recovery.
    return found?.process ?? { processId: pid, userId: '', startedAt: 0, executable: '' }
  }
  class WindowsDiscovery extends VaultBrokerDiscovery {
    override async discover(identify: typeof identity) {
      const deadline = Date.now() + VAULT_BROKER_NATIVE_TIMEOUT_MS
      for (;;) {
        try {
          const location = await super.discover(identify)
          if (!location) return null
          // The broker record carries the pipe name: speak only to a pipe
          // this user's helper owns. A foreign record never directs this
          // client elsewhere. The record is the readiness: the serve helper
          // owns the pipe before the claim names it and keeps an instance of
          // it while the claim stands (the name never vanishes between
          // connections), and a connection made before the channel listens
          // waits in the relay. A dial-and-drop probe proved nothing more.
          const pipe = windowsVaultPipeNameSchema.parse(location.lock.socket)
          const server = await pipeFiles.inspectServer(pipe)
          if (!isVaultPipeServerTrusted(server, ownerSid)) throw new Error(UI_TEXT.vault.noAccess)
          return location
        } catch (error: unknown) {
          // Only proven death permits launch. During a live startup the claim
          // publishes the lock before the boot token: a missing token waits.
          if (
            await isBrokerLockGone(
              pipeFiles.privateFiles,
              this.directory,
              userSession,
              async (processId) => {
                const live = await windowsProcessIdentity(relay, processId)
                return live?.process.startedAt
              },
            )
          )
            return null
          if (!isVaultFileMissing(error) || Date.now() >= deadline) throw error
          await delay(VAULT_BROKER_NATIVE_TIMEOUT_MS / 100)
        }
      }
    }
  }
  const discovery = new WindowsDiscovery(runDirectory, userSession, pipeFiles.privateFiles)
  const removeHost = await registerWindowsVaultHost(
    runDirectory,
    pipeFiles.privateFiles,
    pipeFiles.files,
    relay,
    context.hostId,
    context.hostSession,
  )
  const dial = windowsVaultPipeDial(relay, ownerSid)
  return {
    dispose: () => {
      removeHost()
      void pipeFiles.stop()
    },
    discovery,
    // Files mode owns no connections: this verifier genuinely refuses every
    // socket. The Windows open path verifies through the dialer instead.
    peers: new WindowsVaultPeerVerifier(
      {
        inspect: () => {
          throw new Error(UI_TEXT.vault.noAccess)
        },
      },
      ownerSid,
    ),
    dial,
    process: {
      identity,
      launch: async () => {
        // Only OS facts reach the child: the system root and temporary
        // folders the broker's own launcher needs, never credentials.
        const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }
        for (const name of ['SystemRoot', 'TEMP', 'TMP']) {
          const value = process.env[name]
          if (value !== undefined) env[name] = value
        }
        await pipeFiles.privateFiles.directory(discovery.directory)
        // The claim itself serializes starters: a racing broker loses the
        // claim and exits, and discovery then finds the winner.
        const ready = launchSessionBroker({
          script: path.join(context.distDir, 'vaultBroker.js'),
          payload: {
            dataDir: vaultBrokerDataDir(context.dataDir),
            runDirectory,
            installRoot,
            userSession,
            // File, digest and PowerShell only: the broker reads the guard
            // source from its own install (a command line cannot hold it).
            pipeHelper: launchHelper(plainPipeHelper),
            windowsHelper: launchHelper(plainSlotHelper),
          },
          env,
          isReady: async () => (await discovery.discover(identity)) !== null,
        })
        // A handed-off session broker belongs to no client and exposes no client stop.
        return { ready }
      },
    },
  }
}

export { setUiText } from '../../shared/l10n/text'

import process from 'node:process'
import path from 'node:path'
import os, { homedir } from 'node:os'
import { createConnection } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { UnixVaultPrivateFiles, isVaultFileMissing } from '../../core/vault/broker/files'
import { vaultBrokerLockSchema } from '../../shared/vaultProtocol'
import {
  expectedVaultSocketLocations,
  isExpectedVaultSocket,
  verifyVaultSocketFile,
} from '../../core/vault/broker/socketDirectory'
import { VaultBrokerDiscovery } from '../../core/vault/broker/discovery'
import { UnixVaultPeerVerifier } from '../../core/vault/broker/peer'
import { handoffResourceFile } from '../../core/resources/launcher'
import { UI_TEXT, VAULT_BROKER_NATIVE_TIMEOUT_MS } from '../../shared/constants'
import type { VaultClientPlatform, VaultClientPlatformContext } from './clientPlatform'
import { vaultPeerExecutable, vaultProcessIdentity, vaultSocketDescriptors } from './posixNative'
import { registerPosixVaultHost } from './posixHost'
import { holdVaultStartupLock } from './posixNative'

/** Installed POSIX binding; the public dispatcher owns the availability switch. */
export async function posixVaultClientPlatform(
  context: VaultClientPlatformContext,
): Promise<VaultClientPlatform> {
  // Windows waits on lane C-M109-1c's pipe helper: say the vault is off
  // here, not the generic peer-refusal sentence a person cannot act on.
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error(UI_TEXT.vault.brokerDisabled)
  if (!path.isAbsolute(context.dataDir) || !path.isAbsolute(context.distDir))
    throw new Error(UI_TEXT.vault.noAccess)
  const installRoot = path.dirname(context.distDir)
  const helper = vaultPeerExecutable(installRoot)
  const runDirectory = path.join(context.dataDir, 'vault', 'run')
  const userSession = `${String(process.getuid?.())}:${process.env['XDG_SESSION_ID'] ?? 'login'}`
  const identity = async (pid: number) => {
    const found = await vaultProcessIdentity(helper, pid)
    // Discovery treats a proven-dead owner as absent, allowing the startup lock's recovery.
    return found ?? { processId: pid, userId: '', startedAt: 0, executable: '' }
  }
  class PosixDiscovery extends VaultBrokerDiscovery {
    override async discover(identify: typeof identity) {
      const deadline = Date.now() + VAULT_BROKER_NATIVE_TIMEOUT_MS
      for (;;) {
        try {
          const location = await super.discover(identify)
          if (!location) return null
          // The broker record carries the socket path: speak only to a
          // socket inside this data folder's own bounded location, owned by
          // this user. A foreign record never directs this client elsewhere.
          const expected = expectedVaultSocketLocations(path.join(context.dataDir, 'vault'), {
            platform: process.platform,
            env: process.env,
            tmpdir: os.tmpdir(),
            homeDir: homedir(),
          })
          if (!(await isExpectedVaultSocket(location.lock.socket, expected)))
            throw new Error(UI_TEXT.vault.noAccess)
          await verifyVaultSocketFile(location.lock.socket)
          // Discovery is published before listen; a real socket connection proves readiness.
          await new Promise<void>((resolve, reject) => {
            const socket = createConnection(location.lock.socket)
            socket.once('error', reject)
            socket.once('connect', () => {
              socket.destroy()
              resolve()
            })
          })
          return location
        } catch (error: unknown) {
          // Only proven death permits launch. Missing token/socket during live startup waits.
          let bytes: Buffer
          try {
            bytes = await new UnixVaultPrivateFiles().read(path.join(this.directory, 'broker.lock'))
          } catch (recheckError: unknown) {
            // Orderly shutdown removes token before record, even while its process is still live.
            if (isVaultFileMissing(recheckError)) return null
            throw recheckError
          }
          const lock = vaultBrokerLockSchema.parse(JSON.parse(bytes.toString()))
          const live = await vaultProcessIdentity(helper, lock.processId)
          if (lock.userSession === userSession && live?.startedAt !== lock.startedAt) return null
          const isStarting =
            isVaultFileMissing(error) ||
            (error !== null &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'ECONNREFUSED')
          if (!isStarting || Date.now() >= deadline) throw error
          await delay(VAULT_BROKER_NATIVE_TIMEOUT_MS / 100)
        }
      }
    }
  }
  const dispose = await registerPosixVaultHost(
    runDirectory,
    helper,
    context.hostId,
    context.hostSession,
  )
  const discovery = new PosixDiscovery(runDirectory, userSession)
  return {
    dispose,
    discovery,
    peers: new UnixVaultPeerVerifier(
      helper,
      async (pid) => {
        const found = await vaultProcessIdentity(helper, pid)
        if (!found) throw new Error(UI_TEXT.vault.noAccess)
        return found
      },
      vaultSocketDescriptors,
    ),
    process: {
      identity,
      launch: async () => {
        // Only OS-store transport and native module location facts reach the child.
        const env: NodeJS.ProcessEnv = { HOME: homedir(), ELECTRON_RUN_AS_NODE: '1' }
        for (const name of [
          'DBUS_SESSION_BUS_ADDRESS',
          'XDG_RUNTIME_DIR',
          'XDG_DATA_HOME',
          'TMPDIR',
        ]) {
          const value = process.env[name]
          if (value !== undefined) env[name] = value
        }
        await new UnixVaultPrivateFiles().directory(discovery.directory)
        // Clients queue on the kernel lock, then recheck the winner before spawning.
        const held = await holdVaultStartupLock(
          helper,
          path.join(discovery.directory, 'launch.lock'),
          true,
        )
        const ready = (async () => {
          try {
            if (await discovery.discover(identity)) return
            await handoffResourceFile(
              process.execPath,
              [
                path.join(context.distDir, 'vaultBroker.js'),
                JSON.stringify({
                  dataDir: path.join(context.dataDir, 'vault'),
                  runDirectory,
                  installRoot,
                  userSession,
                }),
              ],
              { env, until: 'spawn' },
            )
            const deadline = Date.now() + VAULT_BROKER_NATIVE_TIMEOUT_MS
            while (Date.now() < deadline) {
              if (await discovery.discover(identity)) return
              await delay(VAULT_BROKER_NATIVE_TIMEOUT_MS / 100)
            }
            throw new Error(UI_TEXT.vault.brokerBlocked)
          } finally {
            await held.release()
          }
        })()
        // A handed-off session broker belongs to no client and exposes no client stop.
        return { ready }
      },
    },
  }
}

export { setUiText } from '../../shared/l10n/text'

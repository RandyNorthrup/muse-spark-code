import process from 'node:process'
import path from 'node:path'
import { homedir } from 'node:os'
import { UnixVaultPrivateFiles } from '../../core/vault/broker/files'
import { vaultBrokerLockSchema } from '../../shared/vaultProtocol'
import { VaultBrokerDiscovery } from '../../core/vault/broker/discovery'
import { UnixVaultPeerVerifier } from '../../core/vault/broker/peer'
import { spawnResourceProcess } from '../../core/resources/launcher'
import { UI_TEXT, VAULT_BROKER_NATIVE_TIMEOUT_MS, VAULT_LIMITS } from '../../shared/constants'
import type { VaultClientPlatform, VaultClientPlatformContext } from './clientPlatform'
import { vaultPeerExecutable, vaultProcessIdentity, vaultSocketDescriptors } from './posixNative'
import { registerPosixVaultHost } from './posixHost'

/** Installed POSIX binding; the public dispatcher owns the availability switch. */
export async function posixVaultClientPlatform(
  context: VaultClientPlatformContext,
): Promise<VaultClientPlatform> {
  if (
    (process.platform !== 'linux' && process.platform !== 'darwin') ||
    !path.isAbsolute(context.dataDir) ||
    !path.isAbsolute(context.distDir)
  )
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
      try {
        return await super.discover(identify)
      } catch (error: unknown) {
        // Only a dead owner permits launch; malformed/private-file failures still refuse.
        const bytes = await new UnixVaultPrivateFiles().read(
          path.join(this.directory, 'broker.lock'),
        )
        const lock = vaultBrokerLockSchema.parse(JSON.parse(bytes.toString()))
        const live = await vaultProcessIdentity(helper, lock.processId)
        if (lock.userSession === userSession && live?.startedAt !== lock.startedAt) return null
        throw error
      }
    }
  }
  await registerPosixVaultHost(runDirectory, helper, context.hostId, context.hostSession)
  return {
    discovery: new PosixDiscovery(runDirectory, userSession),
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
        const { child, stop } = await spawnResourceProcess(
          'contained',
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
          { cwd: installRoot, env },
        )
        child.stdin.end()
        child.stderr.resume()
        const ready = new Promise<void>((resolve, reject) => {
          let text = ''
          const timer = setTimeout(() => {
            reject(new Error(UI_TEXT.vault.brokerBlocked))
          }, VAULT_BROKER_NATIVE_TIMEOUT_MS)
          const failed = () => {
            clearTimeout(timer)
            reject(new Error(UI_TEXT.vault.brokerBlocked))
          }
          child.once('error', failed)
          child.once('exit', failed)
          const data = (bytes: Buffer) => {
            text += bytes.toString()
            if (Buffer.byteLength(text) > VAULT_LIMITS.text) {
              failed()
              return
            }
            if (!text.includes('\n')) return
            clearTimeout(timer)
            child.stdout.removeListener('data', data)
            child.stdout.resume()
            child.removeListener('exit', failed)
            if (text === 'vault-broker-ready\n') resolve()
            else failed()
          }
          child.stdout.on('data', data)
        })
        return { ready, stop }
      },
    },
  }
}

export { setUiText } from '../../shared/l10n/text'

import { StringDecoder } from 'node:string_decoder'
import type { McpChildProcess } from '../../core/backends/modelapi/mcp/stdio'
import type { McpStdioLaunch } from '../../core/backends/modelapi/mcp/servers'
import { admitResource } from '../../core/resources/admission'
import type { McpVaultRoutePorts } from '../../core/vault/mcpSecrets'
import { VaultScrubber } from '../../core/vault/scrub'
import { vaultUseDigest } from '../../core/vault/useDigest'
import { UI_TEXT } from '../../shared/constants'
import type { VaultExecLease } from '../../core/vault/exec/feeder'
import type { mcpServerSpawner, resolveMcpVaultCommand } from './mcpProcess'

/** The installed broker authorizes the exact MCP use before releasing material. */
export interface McpVaultBroker {
  redeem(
    input: Parameters<McpVaultRoutePorts['start']>[0],
    signal: AbortSignal,
  ): Promise<readonly VaultExecLease[]>
  remote: McpVaultRoutePorts['remote']
  oauth?: McpVaultRoutePorts['oauth']
}

/**
 * The window's own MCP parts (mcpServers.ts): its stdio builder and command
 * resolution, shared with unvaulted servers rather than copied here.
 */
export interface McpVaultStartDeps {
  beforeStart(isCancelled: () => boolean): Promise<void>
  assembly(): Promise<string | undefined>
  resolveCommand(launch: McpStdioLaunch, cwd: string): ReturnType<typeof resolveMcpVaultCommand>
  readonly spawner: ReturnType<typeof mcpServerSpawner>
  log(message: string): void
}

/**
 * No server, credentials or lease exists until workspace and resource admission pass.
 * POSTSPAWN: loaded as dist/mcpVault.js on the first vault-backed server, never at activation.
 */
export function governedMcpVaultStart(
  deps: McpVaultStartDeps,
  broker: McpVaultBroker,
): McpVaultRoutePorts['start'] {
  const spawn = deps.spawner
  return async (input) => {
    const controller = new AbortController()
    const resource = await admitResource('mcpServer', controller.signal)
    let leases: readonly VaultExecLease[] = []
    let child: McpChildProcess | undefined
    let scrubber: VaultScrubber | undefined
    const unsubscribe: (() => void)[] = []
    const env = { ...input.launch.env }
    let cleanup: Promise<void> | undefined
    let expiry: ReturnType<typeof setTimeout> | undefined
    let areStreamsDisposed = false
    const release = async (hasSucceeded: boolean) => {
      clearTimeout(expiry)
      areStreamsDisposed = true
      for (const remove of unsubscribe) remove()
      scrubber?.dispose()
      for (const lease of leases) {
        lease.value.fill(0)
        lease.username?.fill(0)
        await lease.close(hasSucceeded)
      }
    }
    const stop = () => {
      cleanup ??= (async () => {
        controller.abort()
        if (child !== undefined) await child.kill()
        await release(false)
      })()
      return cleanup
    }
    const revoked = () => {
      controller.abort()
      if (child !== undefined)
        void stop().catch(() => {
          deps.log('Vault MCP registered tree stop remains unproved')
        })
    }
    const check = () => {
      if (
        input.isCancelled() ||
        controller.signal.aborted ||
        leases.some((lease) => lease.revoked.aborted || lease.expiresAt <= Date.now())
      )
        throw new Error(UI_TEXT.vault.noAccess)
    }
    try {
      await deps.beforeStart(input.isCancelled)
      const assembly = await deps.assembly()
      check()
      leases = await broker.redeem(input, controller.signal)
      if (leases.length !== input.secrets.size) throw new Error(UI_TEXT.vault.noAccess)
      const values = leases.map((lease) => lease.value)
      scrubber = new VaultScrubber(values)
      for (const [index, [name]] of [...input.secrets].entries()) {
        const lease = leases[index]
        if (lease === undefined) throw new Error(UI_TEXT.vault.noAccess)
        const value = new TextDecoder('utf-8', { fatal: true }).decode(lease.value)
        if (value.includes('\0')) throw new Error(UI_TEXT.vault.noAccess)
        env[name] = value
        lease.revoked.addEventListener('abort', revoked, { once: true })
        unsubscribe.push(() => {
          lease.revoked.removeEventListener('abort', revoked)
        })
      }
      await deps.beforeStart(input.isCancelled)
      const command = deps.resolveCommand(input.launch, input.use.command.cwd)
      if (vaultUseDigest({ ...input.use, command }) !== vaultUseDigest(input.use))
        throw new Error(UI_TEXT.vault.useChanged)
      check()
      child = spawn(
        { ...input.launch, command: command.executable, env },
        command.cwd,
        input.isCancelled,
        controller.signal,
        resource,
        assembly,
      )
      const process = child
      expiry = setTimeout(
        revoked,
        Math.max(0, Math.min(...leases.map((lease) => lease.expiresAt)) - Date.now()),
      )
      const out = scrubber.stream()
      const err = scrubber.stream()
      const stdout = new StringDecoder('utf8')
      const stderr = new StringDecoder('utf8')
      const outListeners = new Set<(bytes: Buffer) => void>()
      const errListeners = new Set<(bytes: Buffer) => void>()
      const send = (listeners: typeof outListeners, text: string) => {
        if (text !== '') for (const listener of listeners) listener(Buffer.from(text))
      }
      process.onStdout((bytes) => {
        if (areStreamsDisposed) {
          bytes.fill(0)
          return
        }
        send(outListeners, out.push(stdout.write(bytes)))
      })
      process.onStderr((bytes) => {
        if (areStreamsDisposed) {
          bytes.fill(0)
          return
        }
        send(errListeners, err.push(stderr.write(bytes)))
      })
      process.onExit(() => {
        if (areStreamsDisposed) return
        send(outListeners, out.push(stdout.end()) + out.finish())
        send(errListeners, err.push(stderr.end()) + err.finish())
        void stop().catch(() => {
          deps.log('Vault MCP registered tree stop remains unproved')
        })
      })
      return {
        ...process,
        onStdout: (listener) => {
          outListeners.add(listener)
        },
        onStderr: (listener) => {
          errListeners.add(listener)
        },
        kill: stop,
      }
    } catch (error: unknown) {
      if (child === undefined) {
        resource?.failed?.()
        resource?.complete(true)
        await release(false)
      } else await stop()
      throw error
    } finally {
      for (const name of Object.keys(env)) Reflect.deleteProperty(env, name)
    }
  }
}

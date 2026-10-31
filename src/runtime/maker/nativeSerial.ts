import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import { runSerialAction, type SerialActionInput } from '../../core/maker/serial/session'
import { listSerialPorts } from '../../core/maker/serial/listPorts'
import { startSerialProcess } from '../../core/maker/serial/process'
import { serialAdapterCommand } from '../../core/maker/serial/adapters'
import { prepareWindowsSerialHelper } from '../../core/maker/serial/windowsHelper'
import { listenNativeOwnerPipe, type NativeLeaseHelper } from '../../core/maker/serial/nativeLease'
import type { MakerHost } from '../../core/maker/ports'
import { stopAllHardwareLeases, type LeaseDependencies } from '../../core/maker/lease'
import { killTree, sweepExitedTree, runProgram } from '../../host/processTree'
import { withoutCredentials, withoutKeyringRoutes } from '../credentialVariables'
import {
  environmentValue,
  noWorkspaceChildEnvironment,
  windowsPowerShell,
} from '../../core/execGuard'
import { realpathSync } from 'node:fs'
import { runtimeLeaseIdentity } from './stop'
import {
  RUNTIME_MAKER_APPROVAL_MS,
  RUNTIME_MAKER_CHUNK_BYTES,
  RUNTIME_MAKER_MAX_BYTES,
  RUNTIME_MAKER_MAX_ITEMS,
  RUNTIME_MAKER_POLL_MS,
  RUNTIME_MAKER_SERIAL_BAUD,
  RUNTIME_MAKER_TIMEOUT_MS,
} from '../../shared/constants'

function isExitCodeOne(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.cause instanceof Error &&
    'code' in error.cause &&
    error.cause.code === 1
  )
}

export interface NativeSerialDeps {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly packageRoot: string
  readonly dataDirectory: string
  readonly workspace: string
  readonly host: MakerHost
  readonly refreshAdmission: () => Promise<void>
  /** G4 owns the byte classifier; a missing classifier denies every write. */
  readonly classify?: (
    input: SerialActionInput,
  ) => Promise<'connect' | 'program' | 'actuate' | 'refused'>
  readonly audit: Parameters<typeof runSerialAction>[1]['log']
}
export function nativeSerial(deps: NativeSerialDeps) {
  const env = withoutKeyringRoutes(withoutCredentials(deps.env))
  // Windows names ignore case; a copied environment is a plain object that does not.
  const systemRoot = environmentValue(deps.env, deps.platform, 'SystemRoot')
  const tree = {
    platform: deps.platform,
    systemRoot,
    log: (_message: string) => {
      /* Child diagnostics never enter a surface/log unredacted. */
    },
  }
  let helper: Promise<{ file: string; prefix: readonly string[] }> | undefined
  function prepare() {
    helper ??= (async () => {
      if (deps.platform === 'win32') {
        if (systemRoot === undefined) throw new Error('serial-system-root-required')
        const file = await prepareWindowsSerialHelper({
          directory: deps.dataDirectory,
          systemRoot,
          readSource: () =>
            readFile(
              path.join(deps.packageRoot, 'native', 'windows', 'MuseSparkSerial.cs'),
              'utf8',
            ),
          run: runProgram,
          env,
          log: tree.log,
        })
        return { file, prefix: [] }
      }
      // Fixed shipped helper; the user's installed Python must provide pyserial.
      return {
        file: 'python3',
        prefix: ['-I', path.join(deps.packageRoot, 'native', 'posix', 'serial.py')],
      }
    })()
    return helper
  }
  const processDeps = {
    env,
    platform: deps.platform,
    durationMs: RUNTIME_MAKER_TIMEOUT_MS,
    readyTimeoutMs: RUNTIME_MAKER_TIMEOUT_MS,
    stopGraceMs: RUNTIME_MAKER_POLL_MS,
    maxBytes: RUNTIME_MAKER_MAX_BYTES,
    maxStatusBytes: RUNTIME_MAKER_MAX_BYTES,
    kill: (root: Parameters<typeof killTree>[0], time: number) => killTree(root, tree, time),
    sweep: (pid: number | undefined, start: number, end: number) =>
      sweepExitedTree(pid, start, end, tree),
  }
  async function leaseHelper(): Promise<NativeLeaseHelper> {
    return { ...(await prepare()), process: processDeps }
  }
  const lease: LeaseDependencies = {
    directory: path.join(deps.dataDirectory, 'leases'),
    platform: deps.platform,
    timeoutMs: RUNTIME_MAKER_TIMEOUT_MS,
    maxRecordBytes: RUNTIME_MAKER_MAX_BYTES,
    // Atomic publication never takes the legacy advisory mutex, so none is wired.
    ...runtimeLeaseIdentity(deps.platform, env),
    ...(deps.platform === 'win32' && {
      listenOwnerPipe: async (endpoint: string, id: string, stop: () => Promise<void>) =>
        await listenNativeOwnerPipe(await leaseHelper(), endpoint, id, stop),
    }),
  }
  async function ports() {
    return await listSerialPorts({
      platform: deps.platform,
      maxBytes: RUNTIME_MAKER_MAX_BYTES,
      maxPorts: RUNTIME_MAKER_MAX_ITEMS,
      maxAncestors: RUNTIME_MAKER_MAX_ITEMS,
      run: (file, args) =>
        runProgram(file, args, noWorkspaceChildEnvironment(deps.platform, env, realpathSync)),
      ...(deps.platform === 'win32' &&
        systemRoot !== undefined && {
          powershell: windowsPowerShell(systemRoot).file,
        }),
    })
  }
  const active = new Set<AbortController>()
  const events = new EventTarget()
  async function execute(input: unknown, signal: AbortSignal, onOpen?: () => void) {
    const lifetime = new AbortController()
    active.add(lifetime)
    try {
      return await runSerialAction(input, {
        platform: deps.platform,
        holder: 'Muse Spark runtime',
        lease,
        limits: {
          maxBytes: RUNTIME_MAKER_MAX_BYTES,
          maxDurationMs: RUNTIME_MAKER_TIMEOUT_MS,
          approvalTtlMs: RUNTIME_MAKER_APPROVAL_MS,
          maxIdentityChanges: 2,
        },
        canUseHardware: () =>
          deps.host.isTrusted() && deps.host.hardwareEnabled() && deps.host.isInteractive(),
        classify:
          deps.classify ??
          ((action) => Promise.resolve(action.operation === 'read' ? 'connect' : 'refused')),
        confirm: (request, didReview) => deps.host.confirm(request, didReview),
        identityNow: async (port) => {
          const discovered = await ports()
          await deps.refreshAdmission()
          const identity = discovered.find((item) => item.port === port)
          if (identity === undefined) throw new Error('serial-port-unknown')
          return identity
        },
        // Windows' final native exclusive open is authoritative; POSIX probes ownership only.
        isPortBusy: async (identity) => {
          if (deps.platform === 'win32') return false
          try {
            await runProgram(
              deps.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/fuser',
              [deps.platform === 'darwin' ? '-t' : '-s', '--', identity.port],
              noWorkspaceChildEnvironment(deps.platform, env, realpathSync),
              RUNTIME_MAKER_TIMEOUT_MS,
            )
            return true
          } catch (error: unknown) {
            if (isExitCodeOne(error)) return false
            throw new Error('serial-ownership-unknown', { cause: error })
          }
        },
        open: async (settings, maxBytes, current, start) => {
          const native = await prepare()
          await deps.refreshAdmission()
          const adapter =
            deps.platform === 'win32'
              ? { kind: 'windows' as const, file: native.file }
              : { kind: 'pyserial' as const, file: native.file, script: native.prefix[1] ?? '' }
          const command = serialAdapterCommand(adapter, settings.identity.port, {
            ...settings,
            maxBytes,
            chunkBytes: RUNTIME_MAKER_CHUNK_BYTES,
            pollMs: RUNTIME_MAKER_POLL_MS,
          })
          const process = await startSerialProcess(
            command,
            { ...processDeps, durationMs: settings.durationMs, maxBytes },
            current,
            start,
          )
          onOpen?.()
          return process
        },
        log: deps.audit,
        signal: AbortSignal.any([signal, lifetime.signal]),
      })
    } finally {
      active.delete(lifetime)
      events.dispatchEvent(new Event('settled'))
    }
  }
  return {
    ports,
    lease,
    execute,
    stop(): void {
      for (const controller of active) controller.abort()
    },
    stopOwners: () => stopAllHardwareLeases(lease),
    async close(): Promise<void> {
      for (const controller of active) controller.abort()
      while (active.size > 0) await once(events, 'settled')
    },
    async acquire(port: string, signal: AbortSignal): Promise<() => Promise<void>> {
      const discovered = await ports()
      const identity = discovered.find((item) => item.port === port)
      if (identity === undefined) throw new Error('serial-port-unknown')
      const lifetime = new AbortController()
      const state = { didOpen: false }
      const opened = new EventTarget()
      const readiness = once(opened, 'open')
      const running = execute(
        {
          operation: 'read',
          identity,
          baud: RUNTIME_MAKER_SERIAL_BAUD,
          durationMs: RUNTIME_MAKER_TIMEOUT_MS,
          dtr: false,
          rts: false,
          payloadHex: '',
        },
        AbortSignal.any([signal, lifetime.signal]),
        () => {
          state.didOpen = true
          opened.dispatchEvent(new Event('open'))
        },
      )
      const finished = (async () => {
        await running
        if (!state.didOpen) throw new Error('serial-handover-refused')
      })()
      await Promise.race([readiness, finished])
      return async () => {
        lifetime.abort()
        await running
      }
    },
  }
}

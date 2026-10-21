// The sharing ports the process entry (src/runtime/main.ts) builds: the
// backend options from the documented empty-argv default plus the read path
// through a runtime. It lives here, not in main.ts, so tests can drive the
// production ports with a fake backend: main.ts self-executes on import
// (`void run()`), so it is not import-safe.
import { homedir } from 'node:os'
import { parseCommandLine, type ServeOptions } from '../cliArgs'
import { UI_TEXT } from '../../shared/constants'
import type { AcpBackend } from '../../acp/agent'
import type { AgentHost } from '../../core/agent/agentBackend'
import type { Logger } from '../../host/logger'
import type { RuntimeSharingPorts } from './sharingEntry'

/** The backend surface the sharing ports read through; main passes its live runtime. */
export interface SharingRuntime {
  readonly backend: {
    readonly kind: AcpBackend['kind']
    readonly hostFor: (cwd: string) => Promise<Pick<AgentHost, 'readSession'>>
  }
  readonly close: () => Promise<void>
}

/** The sharing ports' live dependencies: the engine, taken credentials, the OS store. */
export interface SharingPortsDeps {
  readonly createRuntime: (options: ServeOptions, log: Logger) => Promise<SharingRuntime>
  readonly credentialValues: readonly string[]
  readonly readModelApiKey: () => PromiseLike<string | undefined>
}

/**
The sharing ports' backend options: the documented empty-argv default, never
a literal command word (the strict parser treats `serve` as unknown).
*/
export function defaultServeOptions(): ServeOptions {
  const parsed = parseCommandLine([])
  if (parsed.command !== 'serve') throw new Error(UI_TEXT.exportHistoryUnavailable)
  return parsed.options
}

export function sharingPorts(
  log: Logger,
  current: SharingRuntime | undefined,
  deps: SharingPortsDeps,
): RuntimeSharingPorts {
  return {
    folders: { platform: process.platform, env: process.env, homeDir: homedir() },
    registeredSecrets: async () => {
      if (current?.backend.kind !== 'modelApi') return deps.credentialValues
      try {
        const key = await deps.readModelApiKey()
        return key === undefined || key === ''
          ? deps.credentialValues
          : [...deps.credentialValues, key]
      } catch (error) {
        // A key refresh that cannot complete grants no share and discloses no
        // store failure: the person hears the fixed expiry words while the
        // cause travels with the error for the record.
        throw new Error(UI_TEXT.sharePreviewExpired, { cause: error })
      }
    },
    read: async (cwd, sessionId, exportedAt) => {
      const runtime = current ?? (await deps.createRuntime(defaultServeOptions(), log))
      try {
        const host = await runtime.backend.hostFor(cwd)
        const history = await host.readSession(sessionId)
        if (history.mode === 'none') throw new Error(UI_TEXT.exportHistoryUnavailable)
        return {
          sessionId,
          title: history.name ?? UI_TEXT.exportDefaultTitle,
          exportedAt,
          items: history.items,
        }
      } finally {
        if (current === undefined) await runtime.close()
      }
    },
  }
}

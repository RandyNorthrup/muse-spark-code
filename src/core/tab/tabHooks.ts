// M94 lane K, PLAN.md D73: Cursor's two local Tab hook points. The caller
// supplies M91's configured, bounded dispatcher; no process or adapter is
// loaded here. The host owns eligibility and acceptance detection.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  HOOK_MAX_TIMEOUT_SECONDS,
  HOOK_OUTPUT_MAX_BYTES,
  HOOK_STDIN_MAX_BYTES,
  HOOK_TOOL_VALUE_PREVIEW_CHARS,
  MILLISECONDS_PER_SECOND,
  TAB_EDIT_HOOK_QUEUE,
  TAB_HOOK_TIMEOUT_MS,
  TAB_HOOK_VERDICT_CACHE,
} from '../../shared/constants'
import type { ShellResult } from '../shellResult'

export type TabHookEvent = 'beforeTabFileRead' | 'afterTabFileEdit'

export interface TabHookContext {
  readonly workspaceRoots: readonly string[]
  readonly model: string
  readonly generationId: string
}

/** Cursor's saved example has line text, not line numbers (CH:1215–1231). */
export interface TabHookEdit {
  readonly filePath: string
  readonly oldString: string
  readonly newString: string
  readonly oldLine: string
  readonly newLine: string
  readonly range: {
    readonly startLineNumber: number
    readonly startColumn: number
    readonly endLineNumber: number
    readonly endColumn: number
  }
  /** The host identifies these from the item command or its partial-accept guard. */
  readonly acceptance: 'full' | 'partial' | 'typing'
}

/**
 * M91 selects the snapshot's hooks with this fixed matcher, adapts Cursor
 * stdin, and runs under its shared process cap, scrubbed environment, output
 * bounds and tree kill. It caps EACH command's timeout at maxTimeoutMs.
 * [] means no matching hook; undefined means dispatch could not run. A
 * configured guard must return a result, including crashes and cancellations.
 * Results are raw command results, before any fail-open mapping or onFailure.
 */
export interface TabHookRun {
  readonly event: TabHookEvent
  readonly matcherValue: 'TabRead' | 'TabWrite'
  readonly stdin: string
  readonly maxTimeoutMs: number
}

export interface TabHooksDeps {
  readonly isWorkspaceTrusted: () => boolean
  readonly isHooksEnabled: () => boolean
  /** Changes whenever either scope's hook snapshot changes. */
  readonly configurationVersion: () => string
  readonly run: (request: TabHookRun) => Promise<readonly ShellResult[] | undefined>
  /** Counts and fixed status words only: no payload, output, reason or path. */
  readonly log: (message: string) => void
}

const permissionSchema = z.strictObject({ permission: z.enum(['allow', 'deny']) })

function isReadAllowed(result: ShellResult): boolean {
  if (
    result.exitCode !== 0 ||
    result.isCancelled ||
    result.isTimedOut ||
    result.isOutputTooLarge === true ||
    Buffer.byteLength(result.stdout) > HOOK_OUTPUT_MAX_BYTES ||
    Buffer.byteLength(result.stderr) > HOOK_OUTPUT_MAX_BYTES
  ) {
    return false
  }
  try {
    const raw: unknown = JSON.parse(result.stdout)
    const parsed = permissionSchema.safeParse(raw)
    return parsed.success && parsed.data.permission === 'allow'
  } catch {
    return false
  }
}

function envelope(event: TabHookEvent, filePath: string, context: TabHookContext) {
  return {
    hook_event_name: event,
    file_path: filePath,
    workspace_roots: [...context.workspaceRoots],
    model: context.model,
    generation_id: context.generationId,
  }
}

/** A window's verdict LRU and nonblocking FIFO of accepted edits. */
export function createTabHooks(deps: TabHooksDeps) {
  const verdicts = new Map<string, Promise<boolean>>()
  const queue: { readonly stdin: string; readonly version: string }[] = []
  let version = deps.configurationVersion()
  let isRunning = false
  let isDisposed = false

  function currentVersion(): string {
    const next = deps.configurationVersion()
    if (next !== version) {
      verdicts.clear()
      queue.length = 0
      version = next
    }
    return next
  }

  function isAllowed(): boolean {
    return !isDisposed && deps.isWorkspaceTrusted() && deps.isHooksEnabled()
  }

  async function canRead(
    filePath: string,
    content: string,
    context: TabHookContext,
  ): Promise<boolean> {
    if (isDisposed || !deps.isWorkspaceTrusted()) return false
    if (!deps.isHooksEnabled()) return true
    const capturedVersion = currentVersion()
    const digest = createHash('sha256').update(content).digest('hex')
    const key = JSON.stringify([filePath, digest])
    const cached = verdicts.get(key)
    if (cached !== undefined) {
      verdicts.delete(key)
      verdicts.set(key, cached)
      const isReadPermitted = await cached
      return isReadPermitted && isAllowed() && capturedVersion === currentVersion()
    }
    const stdin = JSON.stringify({
      ...envelope('beforeTabFileRead', filePath, context),
      content,
    })
    const verdict = (async () => {
      if (Buffer.byteLength(stdin) > HOOK_STDIN_MAX_BYTES) {
        deps.log('beforeTabFileRead: input exceeds limit; no hook started')
        return false
      }
      let results: readonly ShellResult[] | undefined
      try {
        results = await deps.run({
          event: 'beforeTabFileRead',
          matcherValue: 'TabRead',
          stdin,
          maxTimeoutMs: TAB_HOOK_TIMEOUT_MS,
        })
      } catch {
        // Errors from a hook can echo code, paths or credentials.
        results = undefined
      }
      const isReadPermitted =
        isAllowed() &&
        capturedVersion === currentVersion() &&
        results?.every((result) => isReadAllowed(result)) === true
      deps.log(`beforeTabFileRead: ${isReadPermitted ? 'allowed' : 'denied'}`)
      return isReadPermitted
    })()
    verdicts.set(key, verdict)
    if (verdicts.size > TAB_HOOK_VERDICT_CACHE) {
      const oldest = verdicts.keys().next().value
      if (oldest !== undefined) verdicts.delete(oldest)
    }
    return await verdict
  }

  async function drainEdits(): Promise<void> {
    isRunning = true
    try {
      let next = queue.shift()
      while (next !== undefined) {
        if (isAllowed() && next.version === currentVersion()) {
          try {
            const results = await deps.run({
              event: 'afterTabFileEdit',
              matcherValue: 'TabWrite',
              stdin: next.stdin,
              maxTimeoutMs: HOOK_MAX_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND,
            })
            const observations = results ?? []
            for (const result of observations) {
              deps.log(
                `afterTabFileEdit: exit ${String(result.exitCode)}, timed out ${String(result.isTimedOut)}, cancelled ${String(result.isCancelled)}, output bytes ${String(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr))}`,
              )
            }
            if (results === undefined) deps.log('afterTabFileEdit: dispatch unavailable')
          } catch {
            deps.log('afterTabFileEdit: hook failed')
          }
        }
        next = queue.shift()
      }
    } finally {
      isRunning = false
    }
  }

  function afterEdit(edit: TabHookEdit, context: TabHookContext): void {
    if (!isAllowed() || edit.acceptance === 'typing') return
    const capturedVersion = currentVersion()
    let omitted = 0
    const preview = (text: string): string => {
      const taken = text.slice(0, HOOK_TOOL_VALUE_PREVIEW_CHARS)
      omitted += text.length - taken.length
      return taken
    }
    const stdin = JSON.stringify({
      ...envelope('afterTabFileEdit', edit.filePath, context),
      edits: [
        {
          old_string: preview(edit.oldString),
          new_string: preview(edit.newString),
          old_line: preview(edit.oldLine),
          new_line: preview(edit.newLine),
          range: {
            start_line_number: edit.range.startLineNumber,
            start_column: edit.range.startColumn,
            end_line_number: edit.range.endLineNumber,
            end_column: edit.range.endColumn,
          },
          ...(edit.acceptance === 'partial' && { inferred: true }),
        },
      ],
    })
    if (omitted > 0) deps.log(`afterTabFileEdit: preview omitted ${String(omitted)} characters`)
    if (Buffer.byteLength(stdin) > HOOK_STDIN_MAX_BYTES) {
      deps.log('afterTabFileEdit: input exceeds limit; no hook started')
      return
    }
    if (queue.length >= TAB_EDIT_HOOK_QUEUE) {
      queue.shift()
      deps.log('afterTabFileEdit: oldest waiting edit dropped')
    }
    queue.push({ stdin, version: capturedVersion })
    if (!isRunning) void drainEdits()
  }

  return {
    beforeRead: canRead,
    afterEdit,
    dispose: () => {
      isDisposed = true
      verdicts.clear()
      queue.length = 0
    },
  }
}

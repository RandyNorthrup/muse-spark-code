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

/**
What the hook configuration in force says about one event (RVM94KR 1): no
Tab hook, a configured one, or a hook file present that did not load
whole. Only `absent` reads without a guard; `invalid` refuses every read,
and so does `reloading`: a change was detected and its reload has not
finished (RVM94KR2 3).
*/
export type TabHookState = 'absent' | 'present' | 'invalid' | 'reloading'

/** The hook policy a Tab request binds to at its start (RVM94KR 2). */
export interface TabHookPolicy {
  /** Read again before dispatch and before the answer is used: a change drops the request. */
  readonly key: string
  /** A configured hook file did not load whole: Tab reads nothing until it is fixed. */
  readonly isConfigurationInvalid: boolean
  /** A change was detected and is still reloading: the request reads nothing. */
  readonly isReloading: boolean
}

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
M91 selects the snapshot's hooks with this fixed matcher, adapts Cursor
stdin, and runs under its shared process cap, scrubbed environment, output
bounds and tree kill. It caps EACH command's timeout at maxTimeoutMs.
[] means no matching hook; undefined means dispatch could not run. A
configured guard must return a result, including crashes and cancellations.
Results are raw command results, before any fail-open mapping or onFailure.
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
  /**
  The policy epoch: moves the moment a hook file or setting change is
  detected, before any observer runs, and again when its reload starts.
  */
  readonly configurationVersion: () => string
  /** True from a change's detection until its reload has published (RVM94KR2 3). */
  readonly isReloading?: (() => boolean) | undefined
  /**
  Production loads the snapshot lazily and waits for a pending reload:
  `absent` preserves the old read, `invalid` refuses it, and a rejection
  (no dispatch) refuses it too.
  */
  readonly hookState?: ((event: TabHookEvent) => Promise<TabHookState>) | undefined
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
  } catch (error) {
    // Only a malformed hook answer denies the read: the parser raises
    // SyntaxError for exactly that, so anything else keeps its kind.
    if (!(error instanceof SyntaxError)) throw error
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

  function isTrusted(): boolean {
    return !isDisposed && deps.isWorkspaceTrusted()
  }

  function isAllowed(): boolean {
    return isTrusted() && deps.isHooksEnabled()
  }

  function isReloading(): boolean {
    return deps.isReloading?.() === true
  }

  /** Trust, the opt-in, the policy epoch and the reload: a request's bound key. */
  function policyKey(): string {
    return JSON.stringify([
      isTrusted(),
      deps.isHooksEnabled(),
      deps.configurationVersion(),
      isReloading(),
    ])
  }

  /** Settles the configuration in force first, so its version is the one bound. */
  async function bindPolicy(): Promise<TabHookPolicy> {
    let state: TabHookState | undefined
    if (isAllowed() && deps.hookState !== undefined) {
      try {
        state = await deps.hookState('beforeTabFileRead')
      } catch {
        // No dispatch: every read refuses on its own path.
        state = undefined
      }
    }
    return {
      key: policyKey(),
      isConfigurationInvalid: state === 'invalid',
      isReloading: state === 'reloading' || (isAllowed() && isReloading()),
    }
  }

  async function canRead(
    filePath: string,
    content: string,
    context: TabHookContext,
  ): Promise<boolean> {
    if (!isTrusted()) return false
    if (!deps.isHooksEnabled()) return true
    if (deps.hookState !== undefined) {
      let state: TabHookState
      try {
        state = await deps.hookState('beforeTabFileRead')
      } catch {
        // No dispatch: a hook-state failure refuses the read outright.
        return false
      }
      if (state === 'invalid') {
        deps.log('beforeTabFileRead: hook configuration invalid; read refused')
        return false
      }
      if (state === 'reloading' || isReloading()) {
        deps.log('beforeTabFileRead: hook configuration reloading; read refused')
        return false
      }
      if (state === 'absent') return isTrusted()
    }
    if (isReloading()) return false
    const capturedVersion = currentVersion()
    const digest = createHash('sha256').update(content).digest('hex')
    // A verdict answers for the model the guard was told and the epoch it
    // ran under, never another (RVM94KR2 5).
    const key = JSON.stringify([filePath, digest, context.model, capturedVersion])
    const cached = verdicts.get(key)
    if (cached !== undefined) {
      verdicts.delete(key)
      verdicts.set(key, cached)
      const isReadPermitted = await cached
      return (
        isReadPermitted && isAllowed() && !isReloading() && capturedVersion === currentVersion()
      )
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
        !isReloading() &&
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
    bindPolicy,
    policyKey,
    dispose: () => {
      isDisposed = true
      verdicts.clear()
      queue.length = 0
    },
  }
}

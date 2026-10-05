// Hooks imported in another agent's format (M91 lane W, PLAN.md D70): lane
// P's adapters behind `ForeignHookAdapter`, in a bundle of their own
// (dist/foreignHooks.js, D6) that a session loads the first time it holds an
// imported hook. hooks.ts runs the process (the cap, environment and kill a
// native hook has); this module decides, by the source agent's own rules:
//
// - whether the source would run the hook at all: Cursor's shell-command
//   pattern, Kiro's file triggers by what the call did (lane P applies Kiro's
//   path pattern), and a Cursor stop or subagentStop past its loop limit;
// - the directory it runs in, confined to the workspace once links and
//   junctions are resolved (Cursor's user hooks run from ~/.cursor, as there);
// - how an ending reads: a timeout is told apart from a crash (Copilot lets a
//   timed-out guard through, C:854; Cursor's failClosed blocks on both,
//   CH:707), and a guard that could not run fails as its source fails.
//
// No answer grants: lane P never produces an allow, and hooks.ts strips one.
// The records' reader loads here too, so dist/modelApi.js does not carry it.

import { Buffer } from 'node:buffer'
import path from 'node:path'
import {
  HOOK_CURSOR_DEFAULT_LOOP_LIMIT,
  HOOK_FORMAT_NAME_KEYS,
  HOOK_FORMATS,
  HOOK_WINDOWS_COMMAND_MAX_CHARS,
  UI_TEXT,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_UTF8_PREAMBLE,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { confineWorkspacePath, type RealPathIo } from '../../workspacePath'
import {
  buildForeignStdin,
  parseForeignResult,
  type AdapterOptions,
  type ForeignHookAnswer,
  type HookFormat,
} from './hookFormats'
import { isRecord } from './hookFormats/core'
import {
  matchingHooks,
  type ForeignDispatchContext,
  type ForeignHookAdapter,
  type ForeignHookSpec,
  type ForeignPreparation,
  type ForeignRunResult,
  type HookAnswer,
  type HookDefinition,
  type HookEvent,
} from './hooks'

export { loadForeignHookDefinitions } from './hooks'

export interface ForeignHookAdapterDeps {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
  /** The user's home: Cursor runs its user hooks from `~/.cursor`. */
  readonly homeDir: string | undefined
}

const KIRO_FILE_TRIGGERS: Readonly<Record<string, ForeignDispatchContext['fileOperation']>> = {
  PostFileCreate: 'create',
  PostFileSave: 'save',
  // This runtime has no delete tool, so a delete trigger never runs.
  PostFileDelete: undefined,
}
const LOOP_EVENTS: ReadonlySet<HookEvent> = new Set(['Stop', 'SubagentStop'])
const POWERSHELL = 'powershell.exe'
const ENCODED_COMMAND = '-EncodedCommand'
const TRUNCATED = '[truncated]'
const CURSOR_HOME = '.cursor'

const FORMATS: ReadonlySet<string> = new Set(HOOK_FORMATS)

function isHookFormat(value: string): value is HookFormat {
  return FORMATS.has(value)
}

function commandOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  const input = payload['tool_input']
  const command = isRecord(input) ? input['command'] : undefined
  return typeof command === 'string' ? command : undefined
}

/**
 * Whether Cursor's command pattern selects this command. Cursor tests the
 * full command (CH:745); here the hook sees a bounded preview, so a clipped
 * command, an unreadable one, or a pattern the bounded engine cannot finish
 * runs the guard: running it more often is never weaker than its source.
 */
function isCommandSelected(pattern: string, payload: Readonly<Record<string, unknown>>): boolean {
  const command = commandOf(payload)
  if (command === undefined || command.endsWith(TRUNCATED)) {
    return true
  }
  const state = { isUnsure: false }
  // matchingHooks reads only the event and the matcher: this scope-only
  // definition is never dispatched, and an empty command never runs.
  const scope: HookDefinition = {
    event: 'PreToolUse',
    source: 'project',
    command: '',
    timeoutSeconds: 0,
    isAsync: false,
    matcher: { kind: 'regex', pattern },
  }
  const matched = matchingHooks([scope], 'PreToolUse', command, () => {
    state.isUnsure = true
  })
  return state.isUnsure || matched.length > 0
}

/**
 * The command line a Windows source runs in PowerShell, or undefined to keep
 * the hook's own. Copilot CLI runs `powershell`, and `command` copied to it,
 * in PowerShell (gh/copilot_reference_hooks-configuration.md:124,128);
 * Windsurf runs both through `powershell -Command` (devin
 * cascade_hooks_md.out:104-119); Cline runs its `<HookName>.ps1` with
 * PowerShell (cline-hooks-901d1b5c97.md:157,169). A hook here runs through
 * cmd.exe, as Muse Code's do, so a guard written for PowerShell would fail
 * there and, where its source fails open, let the call through. It goes to
 * Windows PowerShell as an encoded command instead: nothing in it crosses
 * cmd's quoting, and its output is UTF-8.
 */
function powerShellCommand(
  hook: HookDefinition,
  spec: ForeignHookSpec,
): { readonly command: string } | { readonly reason: string } | undefined {
  const isPowerShell =
    spec.format === 'windsurf' ||
    spec.format === 'cline' ||
    (spec.format === 'copilot' && spec.flavor !== 'vscode')
  if (!isPowerShell) {
    return undefined
  }
  // Lane I writes a Cline script's Windows command as PowerShell already:
  // `& '<path>'`, its quotes doubled.
  const encoded = Buffer.from(
    `${WINDOWS_POWERSHELL_UTF8_PREAMBLE}${hook.command}`,
    'utf16le',
  ).toString('base64')
  const command = [
    POWERSHELL,
    ...WINDOWS_POWERSHELL_COMMAND_ARGS.filter((arg) => arg !== '-Command'),
    ENCODED_COMMAND,
    encoded,
  ].join(' ')
  return command.length > HOOK_WINDOWS_COMMAND_MAX_CHARS
    ? { reason: `${spec.format}: the PowerShell command is too long for cmd.exe` }
    : { command }
}

class ForeignHooks implements ForeignHookAdapter {
  /** Follow-ups each Cursor stop or subagentStop script asked for in this conversation. */
  private readonly loops = new Map<HookDefinition, number>()

  public constructor(private readonly deps: ForeignHookAdapterDeps) {}

  private options(spec: ForeignHookSpec, input?: Readonly<Record<string, unknown>>) {
    return {
      sourceEvent: spec.sourceEvent,
      // Only Copilot's flavor names a contract; Cursor's says which kind of
      // event it imported, which its source event already names.
      ...(spec.format === 'copilot' && spec.flavor !== undefined && { flavor: spec.flavor }),
      ...(spec.failClosed !== undefined && { failClosed: spec.failClosed }),
      ...(spec.pathPattern !== undefined && { pathPattern: spec.pathPattern }),
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      ...(input !== undefined && { input }),
    } satisfies AdapterOptions
  }

  private loopLimit(spec: ForeignHookSpec): number | null {
    return spec.loopLimit === undefined ? HOOK_CURSOR_DEFAULT_LOOP_LIMIT : spec.loopLimit
  }

  private isLooped(spec: ForeignHookSpec, event: HookEvent): boolean {
    return spec.format === 'cursor' && LOOP_EVENTS.has(event)
  }

  /** A follow-up past the script's loop limit is not taken; the stop stands (CH:1320). */
  private counted(hook: HookDefinition, spec: ForeignHookSpec, answer: ForeignHookAnswer) {
    const used = this.loops.get(hook) ?? 0
    const limit = this.loopLimit(spec)
    if (limit !== null && used >= limit) {
      return { status: 'completed' as const }
    }
    this.loops.set(hook, used + 1)
    return answer
  }

  /** The working directory, confined by its canonical form; a string says why it is refused. */
  private async directory(
    hook: HookDefinition,
    spec: ForeignHookSpec,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly cwd: string } | { readonly reason: string }> {
    const root = this.deps.workspaceRoot
    if (spec.cwd !== undefined) {
      if (spec.cwd === '.') {
        return { cwd: root }
      }
      const confined = await confineWorkspacePath(root, spec.cwd, this.deps.platform, this.deps.io)
      return confined.ok ? { cwd: confined.checkedAbsolute } : { reason: confined.reason }
    }
    if (spec.format === 'cursor' && hook.source === 'user' && this.deps.homeDir !== undefined) {
      const p = this.deps.platform === 'win32' ? path.win32 : path.posix
      return { cwd: p.join(this.deps.homeDir, CURSOR_HOME) }
    }
    const cwd = payload['cwd']
    return { cwd: typeof cwd === 'string' ? cwd : root }
  }

  public async prepare(
    hook: HookDefinition,
    spec: ForeignHookSpec,
    event: HookEvent,
    payload: Readonly<Record<string, unknown>>,
    context: ForeignDispatchContext | undefined,
  ): Promise<ForeignPreparation> {
    if (spec.format === 'kiro' && Object.hasOwn(KIRO_FILE_TRIGGERS, spec.sourceEvent)) {
      const wanted = KIRO_FILE_TRIGGERS[spec.sourceEvent]
      if (wanted === undefined || (context?.fileOperation ?? 'save') !== wanted) {
        return { outcome: 'skip', reason: `kiro: ${spec.sourceEvent} is not this operation` }
      }
    }
    if (spec.commandPattern !== undefined && !isCommandSelected(spec.commandPattern, payload)) {
      return { outcome: 'skip', reason: 'cursor: the command pattern does not select it' }
    }
    const { format } = spec
    if (!isHookFormat(format)) {
      return { outcome: 'refused', reason: `${format} has no adapter` }
    }
    const fields = this.isLooped(spec, event)
      ? { ...payload, loop_count: this.loops.get(hook) ?? 0 }
      : payload
    const built = buildForeignStdin(format, event, fields, this.options(spec))
    if (built.outcome !== 'run') {
      return built
    }
    const directory = await this.directory(hook, spec, payload)
    if ('reason' in directory) {
      return { outcome: 'refused', reason: directory.reason }
    }
    const shell = this.deps.platform === 'win32' ? powerShellCommand(hook, spec) : undefined
    if (shell !== undefined && 'reason' in shell) {
      return { outcome: 'refused', reason: shell.reason }
    }
    return {
      outcome: 'run',
      stdin: built.stdin,
      cwd: directory.cwd,
      ...(shell !== undefined && { command: shell.command }),
    }
  }

  public answer(
    hook: HookDefinition,
    spec: ForeignHookSpec,
    event: HookEvent,
    result: ForeignRunResult,
    payload: Readonly<Record<string, unknown>>,
  ): HookAnswer {
    const { format } = spec
    if (!isHookFormat(format)) {
      return { status: 'failed', reason: `${format} has no adapter` }
    }
    const options = this.options(spec, payload)
    const name = UI_TEXT[HOOK_FORMAT_NAME_KEYS[format]]
    let answer: ForeignHookAnswer
    if (result.kind === 'exit') {
      answer = parseForeignResult(
        format,
        event,
        result.exitCode,
        result.stdout,
        result.stderr,
        options,
      )
      if (result.exitCode === 0 && answer.status === 'failed') {
        answer = { ...answer, systemMessage: fill(UI_TEXT.hookAdapterUnreadable, { format: name }) }
      }
    } else if (result.kind === 'refused' && result.blockOperation === true) {
      // Lane P: a blocking source event whose input cannot be built refuses
      // the operation it guards (m91-p.md, RVM91P3), whatever its crash rule.
      return {
        status: 'blocked',
        reason: result.reason,
        systemMessage: fill(UI_TEXT.hookAdapterFailClosed, { format: name }),
      }
    } else if (format === 'copilot' && result.kind === 'timeout') {
      // Copilot: "Timeouts are fail-open for every event, including
      // preToolUse" (gh/copilot_reference_hooks-configuration.md:854).
      return { status: 'completed' }
    } else {
      // A crash, a timeout elsewhere, or a hook that could not start: the
      // source's crash rule (exit null), failClosed included.
      answer = parseForeignResult(format, event, null, '', '', options)
      if (answer.status === 'blocked') {
        answer = { ...answer, systemMessage: fill(UI_TEXT.hookAdapterFailClosed, { format: name }) }
      }
    }
    return answer.status === 'blocked' && this.isLooped(spec, event)
      ? this.counted(hook, spec, answer)
      : answer
  }
}

/** The adapters for one session: its loop counts live as long as it does. */
export function createForeignHookAdapter(deps: ForeignHookAdapterDeps): ForeignHookAdapter {
  return new ForeignHooks(deps)
}

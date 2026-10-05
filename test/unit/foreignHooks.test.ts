// M91 lane W (PLAN.md D70, step 10): hooks imported in another agent's format
// run only through lane P's adapters. The import record lane I writes
// (docs/certification/m91-i.md) is checked field by field; the dispatcher
// routes each group to its adapter; a timeout is told apart from a crash by
// each source's rule; the working directory is confined once links resolve;
// Cursor's command pattern and loop limit and Kiro's file triggers decide
// whether the source would run the hook at all; and no answer ever grants.
// The vendor rules cited are lane P's saved pages (docs/certification/m91-p.md).

import { describe, expect, it } from 'vitest'
import {
  dispatchHooks,
  parseForeignHooks,
  parseHookConfig,
  type ForeignHookAdapter,
  type HookDefinition,
  type HookEvent,
} from '../../src/core/backends/modelapi/hooks'
import { createForeignHookAdapter } from '../../src/core/backends/modelapi/foreignHooksEntry'
import type { ShellResult } from '../../src/core/shellResult'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { Buffer } from 'node:buffer'
import { UI_TEXT, WINDOWS_POWERSHELL_UTF8_PREAMBLE } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { importedHooks } from './helpers/sparkHooks'

const ROOT = '/ws'
// A regular-expression match's deadline a loaded rig cannot lapse: the
// command-pattern tests must not depend on wall time (production keeps 25 ms).
const TEST_MATCHER_TIMEOUT_MS = 60_000

interface Ran {
  readonly command: string
  readonly stdin: Record<string, unknown>
  readonly cwd: string
}

function ended(partial: Partial<ShellResult> = {}): ShellResult {
  return { stdout: '', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false, ...partial }
}

/** A runner that records each run and answers with `answer`. */
function runner(answer: (ran: Ran) => ShellResult = () => ended()) {
  const runs: Ran[] = []
  const runHook: NonNullable<ToolIo['runHook']> = (command, stdin, cwd) => {
    const ran: Ran = { command, stdin: JSON.parse(stdin) as Record<string, unknown>, cwd }
    runs.push(ran)
    return Promise.resolve(answer(ran))
  }
  return { runs, io: { runHook } }
}

function adapter(links: Readonly<Record<string, string>> = {}): ForeignHookAdapter {
  return createForeignHookAdapter({
    workspaceRoot: ROOT,
    platform: 'linux',
    io: {
      realPath: (absolutePath) => {
        for (const [link, target] of Object.entries(links)) {
          if (absolutePath === link || absolutePath.startsWith(`${link}/`)) {
            return Promise.resolve(target + absolutePath.slice(link.length))
          }
        }
        return Promise.resolve(absolutePath)
      },
    },
    homeDir: '/home/tester',
    matcherTimeoutMs: TEST_MATCHER_TIMEOUT_MS,
  })
}

/** One spark-hooks.json group, as lane I writes it, parsed for the project. */
const imported = importedHooks

function payload(event: HookEvent, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    hook_event_name: event,
    session_id: 's1',
    turn_id: 't1',
    cwd: ROOT,
    transcript_path: null,
    model: 'muse-spark-1.3',
    model_provider: 'meta',
    permission_mode: 'promptUnmatched',
    ...fields,
  }
}

const shell = (command: string) =>
  payload('PreToolUse', { tool_name: 'bash', tool_input: { command }, tool_use_id: 'u1' })

const cursorShellGuard = (extra: Record<string, unknown> = {}) =>
  imported('PreToolUse', {
    matcher: 'Bash',
    format: 'cursor',
    sourceEvent: 'beforeShellExecution',
    flavor: 'specialized',
    commandPattern: 'curl|wget',
    hooks: [{ type: 'command', command: './guard.sh' }],
    sourceEntry: { command: './guard.sh', matcher: 'curl|wget' },
    ...extra,
  })

const copilotGuard = (extra: Record<string, unknown> = {}, handler: Record<string, unknown> = {}) =>
  imported('PreToolUse', {
    format: 'copilot',
    sourceEvent: 'preToolUse',
    flavor: 'copilot',
    hooks: [{ type: 'command', command: './policy.sh', timeout: 30, ...handler }],
    sourceEntry: { bash: './policy.sh' },
    ...extra,
  })

async function dispatch(
  hooks: readonly HookDefinition[],
  event: HookEvent,
  fields: Record<string, unknown>,
  io: Pick<ToolIo, 'runHook'>,
  options: { adapter?: ForeignHookAdapter | null; operation?: 'create' | 'save' } = {},
) {
  const warnings: string[] = []
  const result = await dispatchHooks(
    hooks,
    event,
    fields,
    event === 'PreToolUse' || event === 'PostToolUse' ? ['bash', 'Bash', 'shell'] : undefined,
    io,
    undefined,
    (message) => {
      warnings.push(message)
    },
    undefined,
    options.adapter === null ? undefined : (options.adapter ?? adapter()),
    { fileOperation: options.operation },
  )
  return { result, warnings }
}

const allowAnswer = () => ended({ stdout: JSON.stringify({ permission: 'allow' }) })
const timedOutRunner = () => runner(() => ended({ exitCode: null, isTimedOut: true }))

const kiroTrigger = (sourceEvent: string) =>
  imported('PostToolUse', {
    matcher: 'Edit|Write',
    format: 'kiro',
    sourceEvent,
    hooks: [{ type: 'command', command: './after.sh', timeout: 60 }],
  })

const cursorStop = (extra: Record<string, unknown>) =>
  imported('Stop', {
    format: 'cursor',
    sourceEvent: 'stop',
    flavor: 'generic',
    hooks: [{ type: 'command', command: './again.sh' }],
    ...extra,
  })

const againAnswer = () => ended({ stdout: JSON.stringify({ followup_message: 'again' }) })

/** Stop rounds against one session's adapter: which blocked, and each run's loop_count. */
async function loopRounds(hooks: readonly HookDefinition[], rounds: number) {
  const shared = adapter()
  const { runs, io } = runner(againAnswer)
  const blocked: boolean[] = []
  for (let round = 0; round < rounds; round += 1) {
    const { result } = await dispatch(
      hooks,
      'Stop',
      payload('Stop', { stop_hook_active: round > 0 }),
      io,
      { adapter: shared },
    )
    blocked.push(result.blockedReason !== undefined)
  }
  return { blocked, loopCounts: runs.map((ran) => ran.stdin['loop_count']) }
}

describe('the import record in spark-hooks.json', () => {
  it('parses a Cursor shell guard with its record kept for the adapter', () => {
    const [hook] = cursorShellGuard({ failClosed: true })
    expect(hook?.event).toBe('PreToolUse')
    expect(hook?.command).toBe('./guard.sh')
    expect(hook?.foreign).toEqual({
      format: 'cursor',
      sourceEvent: 'beforeShellExecution',
      flavor: 'specialized',
      commandPattern: 'curl|wget',
      failClosed: true,
    })
  })

  it('refuses what the record cannot carry, by name', () => {
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ format: 'continue' }, 'format continue has no adapter in this version'],
      [{ format: 'cursor', sourceEvent: 'preToolUse', extra: 1 }, 'unsupported group field extra'],
      [
        { format: 'gemini', sourceEvent: 'BeforeTool', commandPattern: 'x' },
        'commandPattern is Cursor’s only',
      ],
      [
        { format: 'gemini', sourceEvent: 'BeforeTool', failClosed: true },
        'failClosed is Cursor’s only',
      ],
      [
        { format: 'cursor', sourceEvent: 'preToolUse', loop_limit: 3 },
        'loop_limit is Cursor’s, on Stop and SubagentStop only',
      ],
      [
        { format: 'cursor', sourceEvent: 'preToolUse', commandPattern: '(' },
        'commandPattern is not a valid regular expression',
      ],
      [
        { format: 'copilot', sourceEvent: 'preToolUse', flavor: 'pascal' },
        'flavor pascal is not a copilot contract',
      ],
    ]
    for (const [group, reason] of cases) {
      const parsed = parseForeignHooks(
        JSON.stringify({
          hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }], ...group }] },
        }),
        'project',
        'linux',
      )
      expect(parsed.hooks).toEqual([])
      expect(parsed.warnings).toEqual([`project spark-hooks.json: PreToolUse: ${reason}`])
    }
  })

  it('refuses a working directory that leaves the workspace by its text', () => {
    for (const cwd of ['../out', '/etc', 'C:/x']) {
      const parsed = parseForeignHooks(
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                format: 'copilot',
                sourceEvent: 'preToolUse',
                hooks: [{ type: 'command', command: 'x', cwd }],
              },
            ],
          },
        }),
        'project',
        'linux',
      )
      expect(parsed.hooks).toEqual([])
      expect(parsed.warnings[0]).toContain('cwd must be a relative directory inside the workspace')
    }
  })

  it('passes over native groups and extension events, which lane E parses', () => {
    const parsed = parseForeignHooks(
      JSON.stringify({
        hooks: {
          TaskCreated: [{ hooks: [{ type: 'command', command: 'x' }] }],
          PreToolUse: [{ hooks: [{ type: 'command', command: 'native' }] }],
        },
      }),
      'project',
      'linux',
    )
    expect(parsed).toEqual({ hooks: [], warnings: [] })
  })

  it('never takes a format group in Muse Code’s own file', () => {
    const parsed = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              format: 'cursor',
              sourceEvent: 'preToolUse',
              hooks: [{ type: 'command', command: 'x' }],
            },
          ],
        },
      }),
      'project',
      'linux',
    )
    expect(parsed.hooks).toEqual([])
    expect(parsed.warnings).toEqual([
      'project hooks: PreToolUse has unsupported group field format',
    ])
  })
})

describe('dispatch through the adapters', () => {
  it('never runs an imported hook natively: without an adapter it is skipped', async () => {
    const { runs, io } = runner()
    const { result, warnings } = await dispatch(
      cursorShellGuard(),
      'PreToolUse',
      shell('curl x'),
      io,
      {
        adapter: null,
      },
    )
    expect(runs).toEqual([])
    expect(result.blockedReason).toBeUndefined()
    expect(warnings).toEqual(['PreToolUse: cursor-format hook skipped: no adapter here'])
  })

  it('sends Cursor’s own envelope and blocks on its deny (exit 2)', async () => {
    const { runs, io } = runner(() => ended({ exitCode: 2, stderr: 'no network' }))
    const { result } = await dispatch(cursorShellGuard(), 'PreToolUse', shell('curl x'), io)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.stdin).toMatchObject({
      hook_event_name: 'beforeShellExecution',
      command: 'curl x',
      conversation_id: 's1',
    })
    expect(runs[0]?.cwd).toBe(ROOT)
    expect(result.blockedReason).toBe('no network')
  })

  it('applies Cursor’s command pattern before the hook runs (CH:745)', async () => {
    const { runs, io } = runner(() => ended({ exitCode: 2, stderr: 'no' }))
    const { result } = await dispatch(cursorShellGuard(), 'PreToolUse', shell('ls -la'), io)
    expect(runs).toEqual([])
    expect(result.blockedReason).toBeUndefined()
  })

  it('runs the guard when the command preview was clipped: never weaker', async () => {
    const { runs, io } = runner(() => ended({ exitCode: 2, stderr: 'no' }))
    await dispatch(cursorShellGuard(), 'PreToolUse', shell('echo aaaa[truncated]'), io)
    expect(runs).toHaveLength(1)
  })

  it('a foreign allow never grants', async () => {
    const { io } = runner(allowAnswer)
    const { result } = await dispatch(cursorShellGuard(), 'PreToolUse', shell('curl x'), io)
    expect(result).toMatchObject({
      blockedReason: undefined,
      approvalDecision: undefined,
      forceApproval: false,
    })
    // Even an adapter that claimed a grant is stripped by the dispatcher.
    const granting: ForeignHookAdapter = {
      prepare: () => Promise.resolve({ outcome: 'run', stdin: '{}', cwd: ROOT }),
      answer: () => ({
        status: 'completed',
        permissionDecision: 'allow',
        approvalDecision: 'allow',
      }),
    }
    const second = await dispatch(cursorShellGuard(), 'PreToolUse', shell('curl x'), io, {
      adapter: granting,
    })
    expect(second.result.approvalDecision).toBeUndefined()
    expect(second.result.forceApproval).toBe(false)
  })
})

describe('timeouts and crashes, each by its source’s rule', () => {
  it('lets a timed-out Copilot preToolUse through (C:854), but blocks its crash (C:853)', async () => {
    const timedOut = runner(() => ended({ exitCode: null, isTimedOut: true }))
    const late = await dispatch(copilotGuard(), 'PreToolUse', shell('rm x'), timedOut.io)
    expect(late.result.blockedReason).toBeUndefined()
    expect(late.warnings).toEqual(['PreToolUse: copilot-format project hook timed out'])
    const crashed = runner(() => ended({ exitCode: 1, stderr: 'boom' }))
    const broken = await dispatch(copilotGuard(), 'PreToolUse', shell('rm x'), crashed.io)
    expect(broken.result.blockedReason).toBe('boom')
  })

  it('blocks a Cursor guard’s timeout only under failClosed (CH:707), and says why', async () => {
    const open = await dispatch(
      cursorShellGuard(),
      'PreToolUse',
      shell('curl x'),
      timedOutRunner().io,
    )
    expect(open.result.blockedReason).toBeUndefined()
    const closed = await dispatch(
      cursorShellGuard({ failClosed: true }),
      'PreToolUse',
      shell('curl x'),
      timedOutRunner().io,
    )
    expect(closed.result.blockedReason).toBe('cursor hook: hook failed')
    expect(closed.result.messages).toEqual([
      fill(UI_TEXT.hookAdapterFailClosed, { format: UI_TEXT.agentImportSourceCursor }),
    ])
  })

  it('counts an unreadable answer as a failure, said in a notice, never an allow', async () => {
    const { io } = runner(() => ended({ stdout: 'not json' }))
    const hooks = imported('PostToolUse', {
      format: 'cursor',
      sourceEvent: 'postToolUse',
      flavor: 'generic',
      hooks: [{ type: 'command', command: './audit.sh' }],
    })
    const { result } = await dispatch(
      hooks,
      'PostToolUse',
      payload('PostToolUse', {
        tool_name: 'bash',
        tool_input: { command: 'ls' },
        tool_use_id: 'u1',
        tool_response: 'ok',
      }),
      io,
    )
    expect(result.blockedReason).toBeUndefined()
    expect(result.messages).toEqual([
      fill(UI_TEXT.hookAdapterUnreadable, { format: UI_TEXT.agentImportSourceCursor }),
    ])
  })
})

describe('a blocking guard whose input cannot be built (lane P, RVM91P3)', () => {
  it('refuses the operation it guards instead of failing open', async () => {
    const hooks = imported('PreLLMCall', {
      format: 'gemini',
      sourceEvent: 'BeforeModel',
      hooks: [{ type: 'command', command: './model-guard.sh', timeout: 60 }],
    })
    const { runs, io } = runner()
    const { result } = await dispatch(
      hooks,
      'PreLLMCall',
      payload('PreLLMCall', { request_id: 'r1', provider: 'meta' }),
      io,
    )
    expect(runs).toEqual([])
    expect(result.blockedReason).toContain('llm_request')
    expect(result.messages).toEqual([
      fill(UI_TEXT.hookAdapterFailClosed, { format: UI_TEXT.agentImportSourceGemini }),
    ])
  })
})

describe('the working directory, confined once links resolve', () => {
  it('runs in the definition’s directory by its canonical path', async () => {
    const { runs, io } = runner()
    await dispatch(copilotGuard({}, { cwd: 'tools' }), 'PreToolUse', shell('ls'), io, {
      adapter: adapter({ [`${ROOT}/tools`]: `${ROOT}/real/tools` }),
    })
    expect(runs[0]?.cwd).toBe(`${ROOT}/real/tools`)
  })

  it('refuses a directory that leads out through a link: the guard fails as Copilot fails', async () => {
    const { runs, io } = runner()
    const { result, warnings } = await dispatch(
      copilotGuard({}, { cwd: 'escape' }),
      'PreToolUse',
      shell('ls'),
      io,
      { adapter: adapter({ [`${ROOT}/escape`]: '/elsewhere' }) },
    )
    expect(runs).toEqual([])
    expect(result.blockedReason).toBe('copilot hook: hook failed')
    expect(warnings[0]).toContain('leads outside the workspace through a link')
  })

  it('runs a Cursor user hook from ~/.cursor, as Cursor does (CH:653)', async () => {
    const { runs, io } = runner()
    const user = parseForeignHooks(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              format: 'cursor',
              sourceEvent: 'beforeShellExecution',
              hooks: [{ type: 'command', command: './hooks/guard.sh' }],
            },
          ],
        },
      }),
      'user',
      'linux',
    ).hooks
    await dispatch(user, 'PreToolUse', shell('ls'), io)
    expect(runs[0]?.cwd).toBe('/home/tester/.cursor')
  })
})

/** The script an encoded Windows PowerShell command line carries. */
function decodedPowerShell(command: string): string {
  const [program, ...args] = command.split(' ')
  expect(program).toBe('powershell.exe')
  expect(args.slice(0, -2)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'])
  expect(args.at(-2)).toBe('-EncodedCommand')
  return Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le')
}

function importedOnWindows(event: string, group: Record<string, unknown>) {
  return parseForeignHooks(JSON.stringify({ hooks: { [event]: [group] } }), 'project', 'win32')
    .hooks
}

describe('the shell a Windows source runs its hook in', () => {
  const WIN_ROOT = String.raw`C:\ws`
  const windows = createForeignHookAdapter({
    workspaceRoot: WIN_ROOT,
    platform: 'win32',
    io: { realPath: (absolutePath) => Promise.resolve(absolutePath) },
    homeDir: String.raw`C:\Users\tester`,
  })
  const winShell = { ...shell('dir'), cwd: WIN_ROOT }

  it('runs Copilot, Windsurf and Cline hooks in PowerShell, as their sources do', async () => {
    const copilot = importedOnWindows('PreToolUse', {
      format: 'copilot',
      sourceEvent: 'preToolUse',
      flavor: 'copilot',
      hooks: [{ type: 'command', command: 'Write-Output "{}"', timeout: 30 }],
    })
    const windsurf = importedOnWindows('PreToolUse', {
      matcher: 'Bash',
      format: 'windsurf',
      sourceEvent: 'pre_run_command',
      hooks: [{ type: 'command', command: 'python3 guard.py', timeout: 30 }],
    })
    const cline = importedOnWindows('PreToolUse', {
      format: 'cline',
      sourceEvent: 'PreToolUse',
      // Lane I's record: the script quoted for sh, and for PowerShell on Windows.
      hooks: [
        {
          type: 'command',
          timeout: 30,
          command: "'/home/o/Documents/Cline/Hooks/PreToolUse'",
          commandWindows: String.raw`& 'C:\Users\o''brien\Cline\Hooks\PreToolUse.ps1'`,
        },
      ],
    })
    const { runs, io } = runner()
    await dispatchHooks(
      copilot,
      'PreToolUse',
      winShell,
      ['bash'],
      io,
      undefined,
      () => undefined,
      undefined,
      windows,
    )
    await dispatchHooks(
      windsurf,
      'PreToolUse',
      winShell,
      ['bash', 'Bash'],
      io,
      undefined,
      () => undefined,
      undefined,
      windows,
    )
    await dispatchHooks(
      cline,
      'PreToolUse',
      winShell,
      ['bash'],
      io,
      undefined,
      () => undefined,
      undefined,
      windows,
    )
    expect(runs.map((ran) => decodedPowerShell(ran.command))).toEqual([
      `${WINDOWS_POWERSHELL_UTF8_PREAMBLE}Write-Output "{}"`,
      `${WINDOWS_POWERSHELL_UTF8_PREAMBLE}python3 guard.py`,
      `${WINDOWS_POWERSHELL_UTF8_PREAMBLE}${String.raw`& 'C:\Users\o''brien\Cline\Hooks\PreToolUse.ps1'`}`,
    ])
  })

  it('keeps cmd for the others, and every source’s own command off Windows', async () => {
    const cursor = importedOnWindows('PreToolUse', {
      matcher: 'Bash',
      format: 'cursor',
      sourceEvent: 'beforeShellExecution',
      hooks: [{ type: 'command', command: 'guard.cmd' }],
    })
    const { runs, io } = runner()
    await dispatchHooks(
      cursor,
      'PreToolUse',
      winShell,
      ['bash', 'Bash'],
      io,
      undefined,
      () => undefined,
      undefined,
      windows,
    )
    await dispatch(copilotGuard(), 'PreToolUse', shell('ls'), io)
    expect(runs.map((ran) => ran.command)).toEqual(['guard.cmd', './policy.sh'])
  })
})

describe('whether the source would run it at all', () => {
  const written = payload('PostToolUse', {
    tool_name: 'write_file',
    tool_input: { path: 'a.ts', content: 'x' },
    tool_use_id: 'u1',
    tool_response: 'created a.ts',
  })

  it('runs Kiro’s file triggers by what the call did; a delete trigger never', async () => {
    const outcomes: string[] = []
    for (const [trigger, operation] of [
      ['PostFileCreate', 'create'],
      ['PostFileCreate', 'save'],
      ['PostFileSave', 'save'],
      ['PostFileSave', 'create'],
      ['PostFileDelete', 'create'],
    ] as const) {
      const { runs, io } = runner()
      await dispatchHooks(
        kiroTrigger(trigger),
        'PostToolUse',
        written,
        ['write_file', 'Write'],
        io,
        undefined,
        () => undefined,
        undefined,
        adapter(),
        {
          fileOperation: operation,
        },
      )
      outcomes.push(`${trigger}/${operation}:${String(runs.length)}`)
    }
    expect(outcomes).toEqual([
      'PostFileCreate/create:1',
      'PostFileCreate/save:0',
      'PostFileSave/save:1',
      'PostFileSave/create:0',
      'PostFileDelete/create:0',
    ])
  })

  it('stops taking a Cursor stop script’s follow-ups at its loop limit (CH:1320)', async () => {
    expect(await loopRounds(cursorStop({ loop_limit: 1 }), 3)).toEqual({
      blocked: [true, false, false],
      loopCounts: [0, 1, 1],
    })
    // Cursor's default is 5; null leaves only this window's own cap.
    const byDefault = await loopRounds(cursorStop({}), 6)
    expect(byDefault.blocked).toEqual([true, true, true, true, true, false])
    const unlimited = await loopRounds(cursorStop({ loop_limit: null }), 6)
    expect(unlimited.blocked.every(Boolean)).toBe(true)
  })

  it('hands a documented output replacement to the caller, for MCP tools only (CH:919)', async () => {
    const hooks = imported('PostToolUse', {
      format: 'cursor',
      sourceEvent: 'postToolUse',
      flavor: 'generic',
      hooks: [{ type: 'command', command: './redact.sh' }],
    })
    const { io } = runner(() =>
      ended({ stdout: JSON.stringify({ updated_mcp_tool_output: { text: 'redacted' } }) }),
    )
    const mcp = payload('PostToolUse', {
      tool_name: 'mcp__docs__lookup',
      tool_input: { q: 'x' },
      tool_use_id: 'u1',
      tool_response: 'secret',
    })
    const result = await dispatchHooks(
      hooks,
      'PostToolUse',
      mcp,
      undefined,
      io,
      undefined,
      () => undefined,
      undefined,
      adapter(),
    )
    expect(result.replacement).toEqual({ target: 'toolResult', value: { text: 'redacted' } })
    const local = await dispatch(
      hooks,
      'PostToolUse',
      { ...mcp, tool_name: 'bash', tool_input: { command: 'ls' } },
      io,
    )
    expect(local.result.replacement).toBeUndefined()
  })
})

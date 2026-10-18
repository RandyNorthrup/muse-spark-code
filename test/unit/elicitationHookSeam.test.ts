// M91 finish lane: the Elicitation and ElicitationResult hook seam runs real
// extension hooks. Hook scripts below are real POSIX shell processes (a
// person's own hook code, as data); parsing, dispatch, answer protocol and
// verdict mapping are the real production modules. The process cases run on
// POSIX only; the payload builders run everywhere.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dispatchElicitationHooks,
  dispatchElicitationResultHooks,
  dispatchExtensionHooks,
  elicitationFields,
  elicitationResultFields,
  extensionHookPayload,
  parseSparkHooksConfig,
  teammateIdleFields,
  type ElicitationHookFire,
  type ExtensionHookDefinition,
  type ExtensionHookDispatch,
  type ExtensionHookEvent,
} from '../../src/core/backends/modelapi/extensionHooks'
import type { ElicitationHookVerdict } from '../../src/core/backends/modelapi/mcp/elicitation'
import { posixQuoted } from '../../src/core/shellQuote'
import type { ShellResult } from '../../src/core/shellResult'

const SERVER = 'calendar'

/**
 * A minimal real process runner: /bin/sh runs the hook command with the
 * payload on stdin and bounded time, and the observed exit code and streams
 * come back. It stands in only for process entry (the production runner in
 * toolIo adds resource admission and credential fencing); selection,
 * serialization, the answer protocol and verdicts are all production code.
 */
function spawnHookResult(
  command: string,
  payload: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ShellResult> {
  return new Promise<ShellResult>((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let isDone = false
    const finish = (result: ShellResult): void => {
      if (isDone) return
      isDone = true
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ stdout, stderr, exitCode: null, isTimedOut: true, isCancelled: false })
    }, timeoutMs)
    child.stdout.on('data', (chunk: unknown) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk: unknown) => {
      stderr += String(chunk)
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish({ stdout, stderr, exitCode: null, isTimedOut: false, isCancelled: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({
        stdout,
        stderr,
        exitCode: code,
        isTimedOut: false,
        isCancelled: signal?.aborted === true,
      })
    })
    try {
      child.stdin.write(payload)
      child.stdin.end()
    } catch {
      // The child already exited; its close event settles the result.
    }
  })
}

/** A real executable hook script in a fresh temp dir. The command is shell-quoted: a temp path may contain spaces. */
function writeHook(body: string): { readonly dir: string; readonly command: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91-elicitation-'))
  const file = path.join(dir, 'hook.sh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return { dir, command: posixQuoted(file) }
}

function parseHooks(
  event: string,
  command: string,
  source: 'user' | 'project' | 'managed',
  matcher?: string,
): readonly ExtensionHookDefinition[] {
  const parsed = parseSparkHooksConfig(
    JSON.stringify({
      hooks: {
        [event]: [
          {
            ...(matcher !== undefined && { matcher }),
            hooks: [{ type: 'command', command }],
          },
        ],
      },
    }),
    // Managed definitions come from managed settings in production, not a
    // spark-hooks file; the parsed definition is the same data relabelled.
    source === 'managed' ? 'project' : source,
    'linux',
  )
  expect(parsed.warnings).toEqual([])
  expect(parsed.hooks).toHaveLength(1)
  return source === 'managed'
    ? parsed.hooks.map((hook) => ({ ...hook, source: 'managed' as const }))
    : parsed.hooks
}

/** One real dispatch: parsed hooks, the production envelope, a real child. */
async function dispatchFor(
  hooks: readonly ExtensionHookDefinition[],
  event: ExtensionHookEvent,
  dir: string,
  fields: Readonly<Record<string, unknown>>,
  matcherValue: string,
  warnings: string[],
): Promise<ExtensionHookDispatch> {
  return await dispatchExtensionHooks({
    hooks,
    event,
    payload: extensionHookPayload(event, { sessionId: 'session-1', workspaceRoot: dir }, fields),
    matcherValue,
    io: { runHook: spawnHookResult },
    cwd: dir,
    signal: undefined,
    warn: (message) => {
      warnings.push(message)
    },
  })
}

/**
 * The session's fire binding, as data: one scope group of the combined hook
 * list through the real dispatch. The grouping itself — which scopes run,
 * in which order, with which fields — is the production helper under test.
 */
function fireFor(
  hooks: readonly ExtensionHookDefinition[],
  dir: string,
  warnings: string[],
): ElicitationHookFire {
  return async (event, fields, matcherValue, onlySources) => {
    const selected = hooks.filter((hook) => onlySources.includes(hook.source))
    return selected.length === 0
      ? undefined
      : await dispatchFor(selected, event, dir, fields, matcherValue, warnings)
  }
}

/** A hook that records its stdin to a fresh file, for payload observation. */
function recordingHook(): {
  readonly command: string
  readonly dir: string
  readonly seen: string
} {
  const seenDir = mkdtempSync(path.join(tmpdir(), 'm91-seen-'))
  const seen = path.join(seenDir, 'stdin.json')
  const hook = writeHook(`cat > ${posixQuoted(seen)}`)
  return { command: hook.command, dir: hook.dir, seen }
}

function observedStdin(seen: string): Record<string, unknown> {
  return JSON.parse(readFileSync(seen, 'utf8')) as Record<string, unknown>
}

describe('elicitation hook payloads', () => {
  it('tells an Elicitation hook the server, message and field names', () => {
    const fields = elicitationFields(SERVER, 'Enter the code', ['code'], ['code'])
    expect(fields).toEqual({
      server: SERVER,
      message: 'Enter the code',
      fields: ['code'],
      required: ['code'],
    })
  })

  it('bounds a long server message and copies the name lists', () => {
    const names = ['code']
    const fields = elicitationFields(SERVER, `m${'x'.repeat(9000)}`, names, names)
    const message = String(fields['message'])
    expect(message.length).toBeLessThan(9001)
    expect(message.endsWith('[truncated]')).toBe(true)
    expect(message.startsWith(`m${'x'.repeat(4095)}`)).toBe(true)
    expect(fields['fields']).toEqual(['code'])
    expect(fields['fields']).not.toBe(names)
  })

  it('keeps values out of a project ElicitationResult payload', () => {
    expect(
      elicitationResultFields({ server: SERVER, action: 'accept', fieldNames: ['code'] }),
    ).toEqual({ server: SERVER, action: 'accept', fields: ['code'] })
  })

  it('sends values to a user ElicitationResult payload only when accepted', () => {
    expect(
      elicitationResultFields({
        server: SERVER,
        action: 'accept',
        fieldNames: ['code'],
        values: { code: '1234' },
      }),
    ).toEqual({ server: SERVER, action: 'accept', fields: ['code'], values: { code: '1234' } })
    expect(
      elicitationResultFields({ server: SERVER, action: 'decline', fieldNames: ['code'] }),
    ).toEqual({ server: SERVER, action: 'decline', fields: ['code'] })
  })

  it('names the idling task and its running siblings for TeammateIdle', () => {
    expect(teammateIdleFields({ name: 'task-7', siblingsRunning: 2 })).toEqual({
      name: 'task-7',
      siblings_running: 2,
    })
  })
})

describe.runIf(process.platform !== 'win32')('elicitation hooks through real processes', () => {
  interface VerdictCase {
    readonly name: string
    readonly policyScript?: string
    readonly managedScript?: string
    readonly userScript?: string
    readonly matcher?: string
    readonly warningCount: number
    readonly expected: ElicitationHookVerdict
  }

  const VERDICT_CASES: readonly VerdictCase[] = [
    {
      name: 'a project refusal declines with the hook reason',
      policyScript: 'echo "too sensitive for this repo" >&2\nexit 2',
      warningCount: 0,
      expected: {
        decision: 'decline',
        source: 'project',
        reason: 'too sensitive for this repo',
      },
    },
    {
      name: 'a project refusal wins over a user answer',
      policyScript: 'echo "repo policy says no" >&2\nexit 2',
      userScript: 'echo \'{"answer": {"code": "1234"}}\'',
      warningCount: 0,
      expected: { decision: 'decline', source: 'project', reason: 'repo policy says no' },
    },
    {
      name: 'a user answer carries its values to the caller',
      userScript: 'echo \'{"answer": {"code": "1234"}}\'',
      warningCount: 0,
      expected: { decision: 'answer', source: 'user', values: { code: '1234' } },
    },
    {
      name: 'a user answer that is not a record declines instead of guessing',
      userScript: 'echo \'{"answer": 42}\'',
      warningCount: 0,
      expected: { decision: 'decline', source: 'user', reason: 'hook answer is not a record' },
    },
    {
      name: 'a project answer never reaches the caller',
      policyScript: 'echo \'{"answer": {"code": "1234"}}\'',
      warningCount: 0,
      expected: { decision: 'proceed' },
    },
    {
      name: 'a managed refusal declines with the hook reason',
      managedScript: 'echo "managed policy says no" >&2\nexit 2',
      userScript: 'echo \'{"answer": {"code": "1234"}}\'',
      warningCount: 0,
      expected: { decision: 'decline', source: 'project', reason: 'managed policy says no' },
    },
    {
      name: 'a crashed hook does not block the form',
      userScript: 'exit 1',
      warningCount: 1,
      expected: { decision: 'proceed' },
    },
    {
      name: 'with no hooks the form simply shows',
      warningCount: 0,
      expected: { decision: 'proceed' },
    },
    {
      name: 'a matcher selects the server the hook watches',
      policyScript: 'echo "not this server" >&2\nexit 2',
      matcher: 'otherserver',
      warningCount: 0,
      expected: { decision: 'proceed' },
    },
  ]

  for (const kase of VERDICT_CASES) {
    it(kase.name, async () => {
      const warnings: string[] = []
      const dir = mkdtempSync(path.join(tmpdir(), 'm91-workspace-'))
      const hooks: ExtensionHookDefinition[] = []
      const scripts: readonly (readonly [string | undefined, 'project' | 'managed' | 'user'])[] = [
        [kase.policyScript, 'project'],
        [kase.managedScript, 'managed'],
        [kase.userScript, 'user'],
      ]
      for (const [script, source] of scripts) {
        if (script !== undefined) {
          hooks.push(
            ...parseHooks(
              'Elicitation',
              writeHook(script).command,
              source,
              source === 'project' ? kase.matcher : undefined,
            ),
          )
        }
      }
      const verdict = await dispatchElicitationHooks(fireFor(hooks, dir, warnings), {
        server: SERVER,
        message: 'Enter the code',
        fieldNames: ['code'],
        requiredNames: ['code'],
      })
      expect(warnings).toHaveLength(kase.warningCount)
      expect(verdict).toEqual(kase.expected)
    })
  }

  it('a policy refusal settles it without running the user hook', async () => {
    const user = recordingHook()
    const dir = mkdtempSync(path.join(tmpdir(), 'm91-workspace-'))
    const warnings: string[] = []
    const hooks = [
      ...parseHooks(
        'Elicitation',
        writeHook('echo "repo policy says no" >&2\nexit 2').command,
        'project',
      ),
      ...parseHooks('Elicitation', user.command, 'user'),
    ]
    const verdict = await dispatchElicitationHooks(fireFor(hooks, dir, warnings), {
      server: SERVER,
      message: 'Enter the code',
      fieldNames: ['code'],
      requiredNames: ['code'],
    })
    expect(warnings).toEqual([])
    expect(verdict).toEqual({
      decision: 'decline',
      source: 'project',
      reason: 'repo policy says no',
    })
    expect(existsSync(user.seen)).toBe(false)
  })

  interface ResultCase {
    readonly name: string
    readonly action: 'accept' | 'decline'
    readonly values?: Readonly<Record<string, unknown>>
    readonly userValues: unknown
  }

  const RESULT_CASES: readonly ResultCase[] = [
    {
      name: 'ElicitationResult gives accepted values to the user hook alone',
      action: 'accept',
      values: { code: '1234' },
      userValues: { code: '1234' },
    },
    {
      name: 'ElicitationResult on a decline sends values to nobody',
      action: 'decline',
      userValues: undefined,
    },
  ]

  for (const kase of RESULT_CASES) {
    it(kase.name, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'm91-workspace-'))
      const warnings: string[] = []
      const scopes = (['project', 'managed', 'user'] as const).map((scope) => ({
        scope,
        hook: recordingHook(),
      }))
      const hooks = scopes.flatMap(({ scope, hook }) =>
        parseHooks('ElicitationResult', hook.command, scope),
      )
      await dispatchElicitationResultHooks(fireFor(hooks, dir, warnings), {
        server: SERVER,
        fieldNames: ['code'],
        action: kase.action,
        ...(kase.values !== undefined && { values: kase.values }),
      })
      expect(warnings).toEqual([])
      for (const { scope, hook } of scopes) {
        const seen = observedStdin(hook.seen)
        expect(seen).toMatchObject({
          hook_event_name: 'ElicitationResult',
          server: SERVER,
          action: kase.action,
          fields: ['code'],
        })
        expect(seen['values']).toEqual(scope === 'user' ? kase.userValues : undefined)
        if (scope !== 'user') {
          expect(JSON.stringify(seen)).not.toContain('1234')
        }
      }
    })
  }

  it('TeammateIdle reaches the hook with the idle task and sibling count', async () => {
    const hook = recordingHook()
    const warnings: string[] = []
    await dispatchFor(
      parseHooks('TeammateIdle', hook.command, 'user'),
      'TeammateIdle',
      hook.dir,
      teammateIdleFields({ name: 'task-7', siblingsRunning: 2 }),
      'task-7',
      warnings,
    )
    expect(warnings).toEqual([])
    expect(observedStdin(hook.seen)).toMatchObject({
      hook_event_name: 'TeammateIdle',
      name: 'task-7',
      siblings_running: 2,
    })
  })
})

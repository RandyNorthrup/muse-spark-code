// M91 finish lane: the Elicitation and ElicitationResult hook seam runs real
// extension hooks. Hook scripts below are real POSIX shell processes (a
// person's own hook code, as data); parsing, dispatch, answer protocol and
// verdict mapping are the real production modules. The process cases run on
// POSIX only; the payload builders run everywhere.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dispatchExtensionHooks,
  elicitationFields,
  elicitationResultFields,
  extensionHookPayload,
  parseSparkHooksConfig,
  teammateIdleFields,
  type ExtensionHookDefinition,
} from '../../src/core/backends/modelapi/extensionHooks'
import { elicitationVerdictFromDispatch } from '../../src/core/backends/modelapi/mcp/elicitation'
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

/** A real executable hook script in a fresh temp dir. */
function writeHook(body: string): { readonly dir: string; readonly command: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91-elicitation-'))
  const file = path.join(dir, 'hook.sh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return { dir, command: file }
}

function parseHooks(
  event: string,
  command: string,
  source: 'user' | 'project',
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
    source,
    'linux',
  )
  expect(parsed.warnings).toEqual([])
  expect(parsed.hooks).toHaveLength(1)
  return parsed.hooks
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
  it('a project refusal declines with the hook reason', async () => {
    const hook = writeHook('echo "too sensitive for this repo" >&2\nexit 2')
    const hooks = parseHooks('Elicitation', hook.command, 'project')
    const warnings: string[] = []
    const policy = await dispatchExtensionHooks({
      hooks,
      event: 'Elicitation',
      payload: extensionHookPayload(
        'Elicitation',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        elicitationFields(SERVER, 'Enter the code', ['code'], ['code']),
      ),
      matcherValue: SERVER,
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(warnings).toEqual([])
    expect(policy.refusedReason).toBe('too sensitive for this repo')
    expect(elicitationVerdictFromDispatch(policy, undefined)).toEqual({
      decision: 'decline',
      source: 'project',
      reason: 'too sensitive for this repo',
    })
  })

  it('a project refusal wins over a user answer', async () => {
    const policyHook = writeHook('echo "repo policy says no" >&2\nexit 2')
    const userHook = writeHook('echo \'{"answer": {"code": "1234"}}\'')
    const warnings: string[] = []
    const io = { runHook: spawnHookResult }
    const fields = elicitationFields(SERVER, 'Enter the code', ['code'], ['code'])
    const policy = await dispatchExtensionHooks({
      hooks: parseHooks('Elicitation', policyHook.command, 'project'),
      event: 'Elicitation',
      payload: extensionHookPayload(
        'Elicitation',
        { sessionId: 'session-1', workspaceRoot: policyHook.dir },
        fields,
      ),
      matcherValue: SERVER,
      io,
      cwd: policyHook.dir,
      signal: undefined,
      warn: (message) => {
        warnings.push(message)
      },
    })
    const personal = await dispatchExtensionHooks({
      hooks: parseHooks('Elicitation', userHook.command, 'user'),
      event: 'Elicitation',
      payload: extensionHookPayload(
        'Elicitation',
        { sessionId: 'session-1', workspaceRoot: userHook.dir },
        fields,
      ),
      matcherValue: SERVER,
      io,
      cwd: userHook.dir,
      signal: undefined,
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(personal.hasAnswer).toBe(true)
    expect(warnings).toEqual([])
    expect(elicitationVerdictFromDispatch(policy, personal)).toEqual({
      decision: 'decline',
      source: 'project',
      reason: 'repo policy says no',
    })
  })

  it('a user answer carries its values to the caller', async () => {
    const hook = writeHook('echo \'{"answer": {"code": "1234"}}\'')
    const personal = await dispatchExtensionHooks({
      hooks: parseHooks('Elicitation', hook.command, 'user'),
      event: 'Elicitation',
      payload: extensionHookPayload(
        'Elicitation',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        elicitationFields(SERVER, 'Enter the code', ['code'], ['code']),
      ),
      matcherValue: SERVER,
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: () => {
        // The verdict (or observed stdin) below is the assertion.
      },
    })
    expect(elicitationVerdictFromDispatch(undefined, personal)).toEqual({
      decision: 'answer',
      source: 'user',
      values: { code: '1234' },
    })
  })

  it('a user answer that is not a record declines instead of guessing', async () => {
    const hook = writeHook('echo \'{"answer": 42}\'')
    const personal = await dispatchExtensionHooks({
      hooks: parseHooks('Elicitation', hook.command, 'user'),
      event: 'Elicitation',
      payload: extensionHookPayload(
        'Elicitation',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        elicitationFields(SERVER, 'Enter the code', ['code'], ['code']),
      ),
      matcherValue: SERVER,
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: () => {
        // The verdict (or observed stdin) below is the assertion.
      },
    })
    expect(personal.hasAnswer).toBe(true)
    expect(elicitationVerdictFromDispatch(undefined, personal)).toEqual({
      decision: 'decline',
      source: 'user',
      reason: 'hook answer is not a record',
    })
  })

  it('a project answer never reaches the caller', async () => {
    const hook = writeHook('echo \'{"answer": {"code": "1234"}}\'')
    const policy = await dispatchExtensionHooks({
      hooks: parseHooks('Elicitation', hook.command, 'project'),
      event: 'Elicitation',
      payload: extensionHookPayload(
        'Elicitation',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        elicitationFields(SERVER, 'Enter the code', ['code'], ['code']),
      ),
      matcherValue: SERVER,
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: () => {
        // The verdict (or observed stdin) below is the assertion.
      },
    })
    expect(policy.hasAnswer).toBe(true)
    expect(elicitationVerdictFromDispatch(policy, undefined)).toEqual({ decision: 'proceed' })
  })

  it('a crashed hook does not block the form', async () => {
    const hook = writeHook('exit 1')
    const warnings: string[] = []
    const personal = await dispatchExtensionHooks({
      hooks: parseHooks('Elicitation', hook.command, 'user'),
      event: 'Elicitation',
      payload: extensionHookPayload(
        'Elicitation',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        elicitationFields(SERVER, 'Enter the code', ['code'], ['code']),
      ),
      matcherValue: SERVER,
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(personal.refusedReason).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(elicitationVerdictFromDispatch(undefined, personal)).toEqual({ decision: 'proceed' })
  })

  it('with no hooks the form simply shows', () => {
    expect(elicitationVerdictFromDispatch(undefined, undefined)).toEqual({ decision: 'proceed' })
  })

  it('a matcher selects the server the hook watches', async () => {
    const hook = writeHook('echo "not this server" >&2\nexit 2')
    const other = await dispatchExtensionHooks({
      hooks: parseHooks('Elicitation', hook.command, 'project', 'otherserver'),
      event: 'Elicitation',
      payload: extensionHookPayload(
        'Elicitation',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        elicitationFields(SERVER, 'Enter the code', ['code'], ['code']),
      ),
      matcherValue: SERVER,
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: () => {
        // The verdict (or observed stdin) below is the assertion.
      },
    })
    expect(other.refusedReason).toBeUndefined()
    expect(elicitationVerdictFromDispatch(other, undefined)).toEqual({ decision: 'proceed' })
  })

  it('ElicitationResult shows a project hook names and action only', async () => {
    const seenDir = mkdtempSync(path.join(tmpdir(), 'm91-seen-'))
    const seen = path.join(seenDir, 'stdin.json')
    const hook = writeHook('true')
    writeFileSync(path.join(hook.dir, 'hook.sh'), `#!/bin/sh\ncat > "${seen}"\n`, {
      mode: 0o755,
    })
    await dispatchExtensionHooks({
      hooks: parseHooks('ElicitationResult', hook.command, 'project'),
      event: 'ElicitationResult',
      payload: extensionHookPayload(
        'ElicitationResult',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        elicitationResultFields({
          server: SERVER,
          action: 'accept',
          fieldNames: ['code'],
          values: { code: '1234' },
        }),
      ),
      matcherValue: SERVER,
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: () => {
        // The verdict (or observed stdin) below is the assertion.
      },
    })
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toMatchObject({
      hook_event_name: 'ElicitationResult',
      server: SERVER,
      action: 'accept',
      fields: ['code'],
    })
    expect(JSON.parse(readFileSync(seen, 'utf8'))).not.toContain('1234')
  })

  it('ElicitationResult shows a user hook the accepted values', async () => {
    const seenDir = mkdtempSync(path.join(tmpdir(), 'm91-seen-'))
    const seen = path.join(seenDir, 'stdin.json')
    const hook = writeHook('true')
    writeFileSync(path.join(hook.dir, 'hook.sh'), `#!/bin/sh\ncat > "${seen}"\n`, {
      mode: 0o755,
    })
    await dispatchExtensionHooks({
      hooks: parseHooks('ElicitationResult', hook.command, 'user'),
      event: 'ElicitationResult',
      payload: extensionHookPayload(
        'ElicitationResult',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        elicitationResultFields({
          server: SERVER,
          action: 'accept',
          fieldNames: ['code'],
          values: { code: '1234' },
        }),
      ),
      matcherValue: SERVER,
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: () => {
        // The verdict (or observed stdin) below is the assertion.
      },
    })
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toMatchObject({
      values: { code: '1234' },
    })
  })

  it('TeammateIdle reaches the hook with the idle task and sibling count', async () => {
    const seenDir = mkdtempSync(path.join(tmpdir(), 'm91-seen-'))
    const seen = path.join(seenDir, 'stdin.json')
    const hook = writeHook('true')
    writeFileSync(path.join(hook.dir, 'hook.sh'), `#!/bin/sh\ncat > "${seen}"\n`, {
      mode: 0o755,
    })
    await dispatchExtensionHooks({
      hooks: parseHooks('TeammateIdle', hook.command, 'user'),
      event: 'TeammateIdle',
      payload: extensionHookPayload(
        'TeammateIdle',
        { sessionId: 'session-1', workspaceRoot: hook.dir },
        teammateIdleFields({ name: 'task-7', siblingsRunning: 2 }),
      ),
      matcherValue: 'task-7',
      io: { runHook: spawnHookResult },
      cwd: hook.dir,
      signal: undefined,
      warn: () => {
        // The verdict (or observed stdin) below is the assertion.
      },
    })
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toMatchObject({
      hook_event_name: 'TeammateIdle',
      name: 'task-7',
      siblings_running: 2,
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  dispatchHooks,
  HOOK_EVENTS,
  loadHookDefinitions,
  matchingHooks,
  parseHookAnswer,
  parseHookConfig,
  toolMatcherNames,
} from '../../src/core/backends/modelapi/hooks'
import { memoryContextIo } from './helpers/fakeContextIo'

const PROJECT = JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard', timeout: 5 }] }],
  },
})

describe('Muse Code hook config on the Model API backend (M51)', () => {
  it('reads the documented matcher group and Bash alias, with a bounded timeout', () => {
    const parsed = parseHookConfig(PROJECT, 'project', 'win32')
    expect(parsed.warnings).toEqual([])
    expect(parsed.hooks).toHaveLength(1)
    expect(parsed.hooks[0]).toMatchObject({
      event: 'PreToolUse',
      source: 'project',
      command: 'guard',
      timeoutSeconds: 5,
    })
    expect(matchingHooks(parsed.hooks, 'PreToolUse', toolMatcherNames('powershell'))).toHaveLength(
      1,
    )
    expect(matchingHooks(parsed.hooks, 'PreToolUse', toolMatcherNames('read_file'))).toHaveLength(0)
  })

  it('matches a regular expression with a time budget and refuses a pathological one', () => {
    const prefix = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '^web_', hooks: [{ type: 'command', command: 'log' }] }],
        },
      }),
      'project',
      'linux',
    ).hooks
    expect(matchingHooks(prefix, 'PreToolUse', 'web_search')).toHaveLength(1)
    expect(matchingHooks(prefix, 'PreToolUse', 'read_file')).toHaveLength(0)

    const pathological = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '(a+)+$', hooks: [{ type: 'command', command: 'bad' }] }],
        },
      }),
      'project',
      'linux',
    ).hooks
    expect(pathological).toHaveLength(1)
    const warn = vi.fn()
    expect(matchingHooks(pathological, 'PreToolUse', `${'a'.repeat(80)}!`, warn)).toEqual([])
    expect(warn).toHaveBeenCalledWith('hook regular-expression matcher timed out or failed')
  })

  it('rejects an invalid typed field and accepts the wired child-start event', () => {
    const bad = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'guard', timeout: '5' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'stop' }] }],
        },
      }),
      'project',
      'linux',
    )
    expect(bad.hooks).toEqual([])
    expect(bad.warnings.join(' ')).toContain('timeout must be a non-negative integer')

    const child = parseHookConfig(
      JSON.stringify({
        hooks: {
          SubagentStart: [{ hooks: [{ type: 'command', command: 'permit' }] }],
        },
      }),
      'user',
      'linux',
    )
    expect(child.hooks).toMatchObject([{ event: 'SubagentStart' }])
    expect(child.warnings).toEqual([])
  })

  it('loads managed, user, project in order, and nothing while untrusted', async () => {
    const files = new Map<string, string>([
      [
        '/cfg/muse/settings.json',
        JSON.stringify({
          schema_version: 1,
          managed_hooks_path: 'managed.json',
          managed_hooks_env_vars: ['CI_TOKEN'],
          hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-stop' }] }] },
        }),
      ],
      [
        '/cfg/muse/managed.json',
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: 'managed-stop' }] }],
          },
        }),
      ],
      [
        '/ws/.muse/hooks.json',
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: 'project-stop' }] }],
          },
        }),
      ],
    ])
    const warn = vi.fn()
    const deps = {
      io: memoryContextIo(files),
      platform: 'linux' as const,
      settingsPath: '/cfg/muse/settings.json',
      workspaceRoot: '/ws',
      warn,
    }
    const trusted = await loadHookDefinitions({ ...deps, isWorkspaceTrusted: () => true })
    expect(trusted.map((hook) => hook.command)).toEqual([
      'managed-stop',
      'user-stop',
      'project-stop',
    ])
    expect(trusted[0]?.extraEnvNames).toEqual(['CI_TOKEN'])
    expect(trusted[1]?.extraEnvNames).toBeUndefined()
    // Restricted Mode runs no shell command, so no source loads, not even the
    // user's or the administrator's, and no hook file is read.
    const readFile = vi.spyOn(deps.io, 'readFile')
    const untrusted = await loadHookDefinitions({ ...deps, isWorkspaceTrusted: () => false })
    expect(untrusted).toEqual([])
    expect(readFile).not.toHaveBeenCalled()
    readFile.mockRestore()
    expect(warn).not.toHaveBeenCalled()

    files.set(
      '/cfg/muse/settings.json',
      JSON.stringify({
        schema_version: 1,
        managed_hooks_path: 'managed.json',
        managed_hooks_env_vars: ['META_API_KEY'],
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-stop' }] }] },
      }),
    )
    const refused = await loadHookDefinitions({ ...deps, isWorkspaceTrusted: () => true })
    expect(refused.map((hook) => hook.command)).toEqual(['project-stop'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('provider credential name'))
  })
})

describe('hook answer and dispatch (M51)', () => {
  it('uses documented deny and updated-input shapes; malformed output never grants access', () => {
    expect(
      parseHookAnswer(
        'PreToolUse',
        0,
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'blocked by policy',
          },
        }),
        '',
      ),
    ).toMatchObject({ status: 'blocked', reason: 'blocked by policy' })
    expect(
      parseHookAnswer(
        'PreToolUse',
        0,
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: { command: 'echo safe' },
          },
        }),
        '',
      ),
    ).toMatchObject({ status: 'completed', updatedInput: { command: 'echo safe' } })
    expect(parseHookAnswer('PreToolUse', 0, '{"unknown":true}', '').status).toBe('failed')
    expect(
      parseHookAnswer(
        'PreToolUse',
        0,
        '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":null}}',
        '',
      ).status,
    ).toBe('completed')
    expect(
      parseHookAnswer(
        'PreToolUse',
        0,
        '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":null}}',
        '',
      ).status,
    ).toBe('failed')
    expect(
      parseHookAnswer('PreToolUse', 0, '{"hookSpecificOutput":{"hookEventName":"PostToolUse"}}', '')
        .status,
    ).toBe('failed')
    expect(parseHookAnswer('PreToolUse', 2, '', 'no').status).toBe('blocked')
    expect(parseHookAnswer('PostToolUseFailure', 2, '', 'check result')).toEqual({
      status: 'completed',
      reason: 'check result',
    })
    expect(
      parseHookAnswer(
        'PostToolUseFailure',
        0,
        JSON.stringify({
          decision: 'block',
          reason: 'check result',
        }),
        '',
      ).status,
    ).toBe('completed')
  })

  it('feeds post-tool exit-two feedback to the model without treating the tool as unrun', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          PostToolUseFailure: [{ hooks: [{ type: 'command', command: 'check' }] }],
        },
      }),
      'user',
      'linux',
    ).hooks
    const result = await dispatchHooks(
      hooks,
      'PostToolUseFailure',
      { cwd: '/ws', hook_event_name: 'PostToolUseFailure' },
      'read_file',
      {
        runHook: () =>
          Promise.resolve({
            stdout: '',
            stderr: 'check result',
            exitCode: 2,
            isTimedOut: false,
            isCancelled: false,
          }),
      },
      undefined,
      vi.fn(),
    )
    expect(result.blockedReason).toBe('check result')
  })

  it('passes one JSON object to a hook and combines context, denial and approval escalation', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [
                { type: 'command', command: 'first' },
                { type: 'command', command: 'second' },
              ],
            },
          ],
        },
      }),
      'project',
      'linux',
    ).hooks
    const runHook = vi.fn((command: string, payload: string) => {
      expect(JSON.parse(payload)).toMatchObject({
        hook_event_name: 'PreToolUse',
        tool_name: 'bash',
      })
      return Promise.resolve({
        stdout: JSON.stringify({
          hookSpecificOutput:
            command === 'first'
              ? {
                  hookEventName: 'PreToolUse',
                  additionalContext: 'check policy',
                  permissionDecision: 'ask',
                }
              : {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: 'blocked',
                },
        }),
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      })
    })
    const result = await dispatchHooks(
      hooks,
      'PreToolUse',
      { hook_event_name: 'PreToolUse', tool_name: 'bash', cwd: '/ws' },
      'bash',
      { runHook },
      undefined,
      vi.fn(),
    )
    expect(runHook).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      blockedReason: 'blocked',
      contexts: ['check policy'],
      forceApproval: true,
    })
  })

  it('applies continue false before a block decision from the same Stop hook', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'decide' }] }],
        },
      }),
      'user',
      'linux',
    ).hooks
    const result = await dispatchHooks(
      hooks,
      'Stop',
      { cwd: '/ws', stop_hook_active: false },
      undefined,
      {
        runHook: () =>
          Promise.resolve({
            stdout: JSON.stringify({
              continue: false,
              stopReason: 'done',
              decision: 'block',
              reason: 'more',
            }),
            stderr: '',
            exitCode: 0,
            isTimedOut: false,
            isCancelled: false,
          }),
      },
      undefined,
      vi.fn(),
    )
    expect(result.stopReason).toBe('done')
    expect(result.blockedReason).toBeUndefined()
  })

  it('applies continue false only on events whose stop column permits an effect', () => {
    const answer = JSON.stringify({ continue: false, stopReason: 'halt' })
    expect(parseHookAnswer('PreCompact', 0, answer, '').stopReason).toBe('halt')
    expect(parseHookAnswer('UserPromptSubmit', 0, answer, '').stopReason).toBeUndefined()
    expect(parseHookAnswer('StopFailure', 0, answer, '').stopReason).toBeUndefined()
    expect(parseHookAnswer('PreToolUse', 0, answer, '').status).toBe('failed')
  })

  it('runs onFailure after a failed command and applies its answer', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'check',
                  onFailure: { type: 'command', command: 'fallback' },
                },
              ],
            },
          ],
        },
      }),
      'user',
      'linux',
    ).hooks
    const runHook = vi.fn((command: string) =>
      Promise.resolve({
        stdout: command === 'fallback' ? 'fallback context' : '',
        stderr: command === 'check' ? 'failed' : '',
        exitCode: command === 'check' ? 1 : 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const result = await dispatchHooks(
      hooks,
      'UserPromptSubmit',
      { cwd: '/ws', prompt: 'hi' },
      undefined,
      { runHook },
      undefined,
      vi.fn(),
    )
    expect(runHook.mock.calls.map(([command]) => command)).toEqual(['check', 'fallback'])
    expect(result.contexts).toEqual(['fallback context'])
  })

  it('starts async observation hooks without waiting or applying their output', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'observe', async: true }] }],
        },
      }),
      'user',
      'linux',
    ).hooks
    const pending = Promise.withResolvers<{
      stdout: string
      stderr: string
      exitCode: number
      isTimedOut: boolean
      isCancelled: boolean
    }>()
    const runHook = vi.fn(() => pending.promise)
    const result = await dispatchHooks(
      hooks,
      'UserPromptSubmit',
      { cwd: '/ws', prompt: 'hi' },
      undefined,
      { runHook },
      undefined,
      vi.fn(),
    )
    expect(runHook).toHaveBeenCalledOnce()
    expect(result.contexts).toEqual([])
    pending.resolve({
      stdout: 'ignored',
      stderr: '',
      exitCode: 0,
      isTimedOut: false,
      isCancelled: false,
    })
  })

  it('caps hook processes across a burst of async handlers', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [1, 2, 3, 4, 5].map((number) => ({
                type: 'command',
                command: `observe-${String(number)}`,
                async: true,
              })),
            },
          ],
        },
      }),
      'user',
      'linux',
    ).hooks
    const pending = Array.from({ length: 5 }, () =>
      Promise.withResolvers<{
        stdout: string
        stderr: string
        exitCode: number
        isTimedOut: boolean
        isCancelled: boolean
      }>(),
    )
    const started: string[] = []
    const runHook = (command: string) => {
      started.push(command)
      const index = Number(command.slice(-1)) - 1
      const gate = pending[index]
      if (gate === undefined) {
        throw new Error('missing gate')
      }
      return gate.promise
    }
    await dispatchHooks(
      hooks,
      'UserPromptSubmit',
      { cwd: '/ws', prompt: 'hi' },
      undefined,
      { runHook },
      undefined,
      vi.fn(),
    )
    await vi.waitFor(() => {
      expect(started).toHaveLength(4)
    })
    const done = { stdout: '', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false }
    pending[0]?.resolve(done)
    await vi.waitFor(() => {
      expect(started).toHaveLength(5)
    })
    for (const gate of pending.slice(1)) {
      gate.resolve(done)
    }
    await Promise.all(pending.map((gate) => gate.promise))
  })
})

describe('Muse parity events (M91 lane R)', () => {
  it('wires Interrupt and SessionFork beside the Muse Code events', () => {
    expect(HOOK_EVENTS).toContain('Interrupt')
    expect(HOOK_EVENTS).toContain('SessionFork')
  })

  it('accepts Interrupt only as async, as Muse Code 1.4.2 does (research run C)', () => {
    const refused = parseHookConfig(
      JSON.stringify({
        hooks: { Interrupt: [{ hooks: [{ type: 'command', command: 'note' }] }] },
      }),
      'project',
      'linux',
    )
    expect(refused.hooks).toEqual([])
    expect(refused.warnings.join(' ')).toContain('Interrupt must be asynchronous')

    const accepted = parseHookConfig(
      JSON.stringify({
        hooks: { Interrupt: [{ hooks: [{ type: 'command', command: 'note', async: true }] }] },
      }),
      'project',
      'linux',
    )
    expect(accepted.warnings).toEqual([])
    expect(accepted.hooks).toMatchObject([{ event: 'Interrupt', isAsync: true }])
  })

  it('accepts SessionFork only as sync and runs it with no matcher', () => {
    const refused = parseHookConfig(
      JSON.stringify({
        hooks: { SessionFork: [{ hooks: [{ type: 'command', command: 'veto', async: true }] }] },
      }),
      'project',
      'linux',
    )
    expect(refused.hooks).toEqual([])
    expect(refused.warnings.join(' ')).toContain('SessionFork cannot be asynchronous')

    const accepted = parseHookConfig(
      JSON.stringify({
        hooks: {
          SessionFork: [{ matcher: 'some-tool', hooks: [{ type: 'command', command: 'veto' }] }],
        },
      }),
      'project',
      'linux',
    )
    expect(accepted.warnings).toEqual([])
    expect(accepted.hooks).toMatchObject([{ event: 'SessionFork', isAsync: false }])
    expect(matchingHooks(accepted.hooks, 'SessionFork', 'some-tool')).toHaveLength(1)
  })

  it('accepts updatedInput on PostToolUseFailure for the correction, refusing it elsewhere', () => {
    expect(
      parseHookAnswer(
        'PostToolUseFailure',
        0,
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUseFailure',
            updatedInput: { command: 'echo fixed' },
          },
        }),
        '',
      ),
    ).toMatchObject({ status: 'completed', updatedInput: { command: 'echo fixed' } })
    for (const event of ['PostToolUse', 'Stop', 'Notification'] as const) {
      expect(
        parseHookAnswer(
          event,
          0,
          JSON.stringify({
            hookSpecificOutput: { hookEventName: event, updatedInput: { command: 'echo fixed' } },
          }),
          '',
        ).status,
      ).toBe('failed')
    }
  })

  it('never lets an Interrupt answer block: exit 2 fails instead', () => {
    expect(parseHookAnswer('Interrupt', 2, '', 'stop it').status).toBe('failed')
  })
})

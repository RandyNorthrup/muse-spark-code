// M91 lane E: spark-hooks.json and the 21 extension events (PLAN.md M91
// acceptance 3, 4, 13; SoL-Pi rules 2 and 7). Payloads follow Claude Code's
// documented hook fields (https://code.claude.com/docs/en/hooks): the
// envelope (`hook_event_name`, `session_id`, `cwd`, `transcript_path`,
// `permission_mode`) with this runtime's additions (`turn_id`, `model`,
// `model_provider`), and each event's documented fields; answers follow the
// same contract (exit 0 parses JSON, exit 2 refuses where the event can
// refuse). Every guard below has a red drill in docs/certification/m91-e.md.

import { describe, expect, it, vi } from 'vitest'
import {
  afterAgentThoughtFields,
  beforeToolSelectionFields,
  createFileChangedThrottle,
  dispatchExtensionHooks,
  elicitationResultFields,
  extensionHookPayload,
  fileChangedFields,
  instructionsLoadedFields,
  isToolAllowedBySelection,
  loadSparkHookDefinitions,
  manualFields,
  manualHooks,
  messageDisplayFields,
  parseExtensionHookAnswer,
  parseSparkHooksConfig,
  permissionDeniedFields,
  setupFields,
  isSetupTriggerMatch,
  taskFields,
  teammateIdleFields,
  userPromptExpansionFields,
  type ExtensionHookDefinition,
} from '../../src/core/backends/modelapi/extensionHooks'
import type { HookLoadDeps } from '../../src/core/backends/modelapi/hooks'
import { memoryContextIo } from './helpers/fakeContextIo'

function spark(hooks: unknown): string {
  return JSON.stringify({ hooks })
}

function loadDeps(files: Map<string, string | Uint8Array>, isTrusted = true): HookLoadDeps {
  const warnings: string[] = []
  return {
    io: memoryContextIo(files),
    platform: 'linux',
    settingsPath: '/config/muse/settings.json',
    workspaceRoot: '/ws',
    isWorkspaceTrusted: () => isTrusted,
    warn: (message: string) => {
      warnings.push(message)
    },
  }
}

function hookFor(event: string, command: string): readonly ExtensionHookDefinition[] {
  return parseSparkHooksConfig(
    spark({ [event]: [{ hooks: [{ type: 'command', command }] }] }),
    'project',
    'linux',
  ).hooks
}

function shellResult(stdout: string, stderr: string, exitCode: number | null) {
  return { stdout, stderr, exitCode, isTimedOut: false, isCancelled: false }
}

describe('parseSparkHooksConfig', () => {
  it('loads extension events and refuses a Muse Code name with a warning', () => {
    const parsed = parseSparkHooksConfig(
      spark({
        TaskCreated: [{ hooks: [{ type: 'command', command: 'guard' }] }],
        PreToolUse: [{ hooks: [{ type: 'command', command: 'twice' }] }],
      }),
      'project',
      'linux',
    )
    expect(parsed.hooks.map((hook) => hook.command)).toEqual(['guard'])
    expect(parsed.warnings).toEqual([
      'project spark-hooks.json: PreToolUse is a Muse Code event: configure it in .muse/hooks.json, so it runs once',
    ])
  })

  it('skips an unknown event with a warning while the rest stays in effect', () => {
    const parsed = parseSparkHooksConfig(
      spark({
        NoSuchEvent: [{ hooks: [{ type: 'command', command: 'nope' }] }],
        Manual: [{ hooks: [{ type: 'command', command: 'kept' }] }],
      }),
      'user',
      'linux',
    )
    expect(parsed.hooks.map((hook) => hook.command)).toEqual(['kept'])
    expect(parsed.warnings).toEqual(['user spark-hooks.json: unsupported event NoSuchEvent'])
  })

  it('rejects invalid JSON and a missing hooks object', () => {
    expect(parseSparkHooksConfig('not json', 'project', 'linux').warnings).toEqual([
      'project spark-hooks.json: invalid JSON',
    ])
    expect(parseSparkHooksConfig('{"other": 1}', 'project', 'linux').warnings).toEqual([
      'project spark-hooks.json: missing hooks object',
    ])
  })

  it('requires a matcher on FileChanged: an empty matcher watches nothing', () => {
    for (const matcher of [undefined, '']) {
      const group: Record<string, unknown> = { hooks: [{ type: 'command', command: 'watch' }] }
      if (matcher !== undefined) {
        group['matcher'] = matcher
      }
      const parsed = parseSparkHooksConfig(spark({ FileChanged: [group] }), 'project', 'linux')
      expect(parsed.hooks).toEqual([])
      expect(parsed.warnings).toEqual([
        'project spark-hooks.json: FileChanged: FileChanged needs a matcher: an empty matcher watches nothing',
      ])
    }
  })

  it('accepts init and maintenance Setup matchers and refuses anything else', () => {
    const ok = parseSparkHooksConfig(
      spark({
        Setup: [{ matcher: 'init|maintenance', hooks: [{ type: 'command', command: 's' }] }],
      }),
      'project',
      'linux',
    )
    expect(ok.hooks).toHaveLength(1)
    const bad = parseSparkHooksConfig(
      spark({ Setup: [{ matcher: 'startup', hooks: [{ type: 'command', command: 's' }] }] }),
      'project',
      'linux',
    )
    expect(bad.hooks).toEqual([])
    expect(bad.warnings).toEqual([
      'project spark-hooks.json: Setup: Setup matcher must be init or maintenance',
    ])
  })

  it('refuses a matcher on events that define no matcher value', () => {
    const parsed = parseSparkHooksConfig(
      spark({ MessageDisplay: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'm' }] }] }),
      'project',
      'linux',
    )
    expect(parsed.hooks).toEqual([])
    expect(parsed.warnings).toEqual([
      'project spark-hooks.json: MessageDisplay: matcher is not valid for MessageDisplay',
    ])
  })

  it('runs only command handlers until lane H adds the rest', () => {
    const parsed = parseSparkHooksConfig(
      spark({ Manual: [{ hooks: [{ type: 'prompt', command: 'x' }] }] }),
      'project',
      'linux',
    )
    expect(parsed.hooks).toEqual([])
    expect(parsed.warnings).toEqual([
      'project spark-hooks.json: Manual: handler type must be command',
    ])
  })

  it('refuses a file past the per-source handler limit', () => {
    const many = Array.from({ length: 65 }, (_, index) => ({
      type: 'command',
      command: `hook-${String(index)}`,
    }))
    const parsed = parseSparkHooksConfig(spark({ Manual: [{ hooks: many }] }), 'project', 'linux')
    expect(parsed.hooks).toEqual([])
    expect(parsed.warnings).toEqual(['project spark-hooks.json exceeds the handler limit'])
  })

  it('rejects a mistyped timeout for the whole file', () => {
    const parsed = parseSparkHooksConfig(
      spark({ Manual: [{ hooks: [{ type: 'command', command: 'm', timeout: '5' }] }] }),
      'project',
      'linux',
    )
    expect(parsed.hooks).toEqual([])
    expect(parsed.warnings).toEqual([
      'project spark-hooks.json: Manual: handler timeout must be a non-negative integer',
    ])
  })
})

describe('loadSparkHookDefinitions', () => {
  it('loads nothing in an untrusted workspace', async () => {
    const files = new Map<string, string>([
      [
        '/ws/.muse/spark-hooks.json',
        spark({ Manual: [{ hooks: [{ type: 'command', command: 'm' }] }] }),
      ],
    ])
    await expect(loadSparkHookDefinitions(loadDeps(files, false))).resolves.toEqual([])
  })

  it('loads the user file beside the settings and the project file inside the workspace', async () => {
    const files = new Map<string, string>([
      [
        '/config/muse/spark-hooks.json',
        spark({ Setup: [{ hooks: [{ type: 'command', command: 'u' }] }] }),
      ],
      [
        '/ws/.muse/spark-hooks.json',
        spark({ Manual: [{ hooks: [{ type: 'command', command: 'p' }] }] }),
      ],
    ])
    const hooks = await loadSparkHookDefinitions(loadDeps(files))
    expect(hooks.map((hook) => [hook.source, hook.command])).toEqual([
      ['user', 'u'],
      ['project', 'p'],
    ])
  })

  it('loads nothing when the files are missing', async () => {
    await expect(loadSparkHookDefinitions(loadDeps(new Map()))).resolves.toEqual([])
  })
})

describe('extension payloads', () => {
  const context = {
    sessionId: 'session-1',
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    permissionMode: 'allowAll',
    turnId: 'turn-9',
  }

  it('sends the documented envelope with the runtime additions', () => {
    expect(
      extensionHookPayload('TaskCreated', context, taskFields({ subject: 's', description: 'd' })),
    ).toEqual({
      hook_event_name: 'TaskCreated',
      session_id: 'session-1',
      turn_id: 'turn-9',
      cwd: '/ws',
      transcript_path: null,
      model: 'muse-spark-1.3',
      model_provider: 'meta',
      permission_mode: 'allowAll',
      subject: 's',
      description: 'd',
    })
  })

  it('bounds the task subject and description', () => {
    const fields = taskFields({ subject: 's'.repeat(300), description: 'd'.repeat(2000) })
    expect(fields['subject']).toBe(`${'s'.repeat(256)}[truncated]`)
    expect(fields['description']).toBe(`${'d'.repeat(1024)}[truncated]`)
  })

  it('scrubs credentials and bounds a finished thought', () => {
    const fields = afterAgentThoughtFields('Bearer abcdef12345 and more')
    expect(fields['thought']).not.toContain('abcdef12345')
    expect(afterAgentThoughtFields('t'.repeat(3000))['thought']).toBe(
      `${'t'.repeat(2048)}[truncated]`,
    )
  })

  it('bounds the display message and the expansion', () => {
    expect(messageDisplayFields('m'.repeat(5000))['message']).toBe(`${'m'.repeat(4096)}[truncated]`)
    const expansion = userPromptExpansionFields({
      trigger: 'skill',
      name: 'review',
      expanded: 'e'.repeat(3000),
    })
    expect(expansion).toMatchObject({ trigger: 'skill', name: 'review' })
    expect(expansion['expanded']).toBe(`${'e'.repeat(2048)}[truncated]`)
  })

  it('names the tool on a tool refusal and omits it on a mode refusal', () => {
    expect(permissionDeniedFields({ toolName: 'bash', reason: 'no' })).toMatchObject({
      tool_name: 'bash',
    })
    expect(permissionDeniedFields({ reason: 'manual mode' })).not.toContain('tool_name')
  })

  it('gives a project ElicitationResult field names only, and a user hook the values', () => {
    expect(
      elicitationResultFields({ server: 's', action: 'accept', fieldNames: ['city'] }),
    ).not.toContain('values')
    expect(
      elicitationResultFields({
        server: 's',
        action: 'accept',
        fieldNames: ['city'],
        values: { city: 'Oslo' },
      }),
    ).toMatchObject({ values: { city: 'Oslo' } })
  })

  it('sends paths with reasons, never content', () => {
    expect(fileChangedFields('src/app.ts', 'watcher')).toEqual({
      path: 'src/app.ts',
      reason: 'watcher',
    })
    expect(instructionsLoadedFields('AGENTS.md', 'touched-path')).toEqual({
      path: 'AGENTS.md',
      reason: 'touched-path',
    })
    expect(setupFields('maintenance')).toEqual({ trigger: 'maintenance' })
    expect(manualFields('deploy')).toEqual({ name: 'deploy' })
    expect(teammateIdleFields({ name: 'attempt 2', siblingsRunning: 2 })).toEqual({
      name: 'attempt 2',
      siblings_running: 2,
    })
    expect(beforeToolSelectionFields(['read_file', 'bash'])).toEqual({
      tools: ['read_file', 'bash'],
    })
  })
})

describe('parseExtensionHookAnswer', () => {
  it('refuses with the hook reason on exit 2 where the event can refuse', () => {
    for (const event of [
      'TaskCreated',
      'UserPromptExpansion',
      'PreModelSwitch',
      'Elicitation',
    ] as const) {
      expect(parseExtensionHookAnswer(event, 2, '', 'no, because reasons').status).toBe('refused')
      expect(parseExtensionHookAnswer(event, 2, '', 'no, because reasons').reason).toBe(
        'no, because reasons',
      )
    }
  })

  it('never refuses where the event cannot: observation stays a failure', () => {
    expect(parseExtensionHookAnswer('FileChanged', 2, '', 'burst').status).toBe('failed')
    expect(parseExtensionHookAnswer('MessageDisplay', 2, '', 'no').status).toBe('failed')
  })

  it('keeps a teammate working and fails the attempt on a worktree error', () => {
    expect(parseExtensionHookAnswer('TeammateIdle', 2, '', 'almost done').status).toBe(
      'keepWorking',
    )
    expect(parseExtensionHookAnswer('WorktreeCreate', 3, '', 'git broke').status).toBe(
      'attemptFailed',
    )
    expect(parseExtensionHookAnswer('WorktreeCreate', 3, '', 'git broke').reason).toBe('git broke')
  })

  it('takes a deny decision on refusing events, and fails it elsewhere', () => {
    const deny = JSON.stringify({ decision: { behavior: 'deny', message: 'not yet' } })
    expect(parseExtensionHookAnswer('TaskCompleted', 0, deny, '').status).toBe('refused')
    expect(parseExtensionHookAnswer('FileChanged', 0, deny, '').status).toBe('failed')
  })

  it('rewrites the display text only on MessageDisplay', () => {
    const rewrite = JSON.stringify({ displayText: 'shorter' })
    const shown = parseExtensionHookAnswer('MessageDisplay', 0, rewrite, '')
    expect(shown).toMatchObject({ status: 'completed', displayText: 'shorter' })
    expect(parseExtensionHookAnswer('FileChanged', 0, rewrite, '').status).toBe('failed')
  })

  it('narrows tools only on BeforeToolSelection', () => {
    const narrowed = JSON.stringify({ allowedTools: ['read_file'] })
    expect(parseExtensionHookAnswer('BeforeToolSelection', 0, narrowed, '').allowedTools).toEqual([
      'read_file',
    ])
    expect(parseExtensionHookAnswer('TaskCreated', 0, narrowed, '').status).toBe('failed')
  })

  it('passes an Elicitation answer through and refuses it elsewhere', () => {
    const answer = JSON.stringify({ answer: { city: 'Oslo' } })
    const passed = parseExtensionHookAnswer('Elicitation', 0, answer, '')
    expect(passed.hasAnswer).toBe(true)
    expect(passed.answer).toEqual({ city: 'Oslo' })
    expect(parseExtensionHookAnswer('TaskCreated', 0, answer, '').status).toBe('failed')
  })

  it('adds context on turn-bound events and refuses it outside a turn', () => {
    const context = JSON.stringify({ additionalContext: 'remember this' })
    expect(parseExtensionHookAnswer('AfterAgentThought', 0, context, '').context).toBe(
      'remember this',
    )
    expect(parseExtensionHookAnswer('FileChanged', 0, context, '').status).toBe('failed')
    expect(parseExtensionHookAnswer('DirectoryAdded', 0, context, '').status).toBe('failed')
  })

  it('keeps working on continue false only for TeammateIdle', () => {
    const keep = JSON.stringify({ continue: false, stopReason: 'one more check' })
    expect(parseExtensionHookAnswer('TeammateIdle', 0, keep, '')).toMatchObject({
      status: 'keepWorking',
      reason: 'one more check',
    })
    expect(parseExtensionHookAnswer('TaskCreated', 0, keep, '').status).toBe('failed')
  })

  it('fails invalid JSON and unknown fields without touching the operation', () => {
    expect(parseExtensionHookAnswer('TaskCreated', 0, '{oops', '').status).toBe('failed')
    expect(parseExtensionHookAnswer('TaskCreated', 0, '{"retry": true}', '').status).toBe('failed')
  })

  it('scrubs and caps a system message', () => {
    const message = parseExtensionHookAnswer(
      'TaskCreated',
      0,
      JSON.stringify({ systemMessage: 'ok\u{1}then more' }),
      '',
    )
    expect(message.message).toBe('ok then more')
  })
})

describe('dispatchExtensionHooks', () => {
  const payload = { hook_event_name: 'Manual', session_id: 's', cwd: '/ws' } as const

  it('runs the matching hook with the payload and collects its message', async () => {
    const runHook = vi.fn(() =>
      Promise.resolve(shellResult(JSON.stringify({ systemMessage: 'noted' }), '', 0)),
    )
    const seen: string[] = []
    const result = await dispatchExtensionHooks({
      hooks: hookFor('Manual', 'run-me'),
      event: 'Manual',
      payload,
      io: { runHook },
      cwd: '/ws',
      warn: (message) => {
        seen.push(message)
      },
    })
    expect(runHook).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(runHook.mock.calls[0]?.[1]))).toMatchObject({
      hook_event_name: 'Manual',
    })
    expect(result.messages).toEqual(['noted'])
    expect(result.output).toBe(JSON.stringify({ systemMessage: 'noted' }))
    expect(seen).toEqual([])
  })

  it('selects Setup hooks by trigger', async () => {
    const hooks = parseSparkHooksConfig(
      spark({
        Setup: [
          { matcher: 'init', hooks: [{ type: 'command', command: 'init-only' }] },
          { hooks: [{ type: 'command', command: 'always' }] },
        ],
      }),
      'project',
      'linux',
    ).hooks
    const runHook = vi.fn(() => Promise.resolve(shellResult('', '', 0)))
    const dispatch = (trigger: 'init' | 'maintenance') =>
      dispatchExtensionHooks({
        hooks,
        event: 'Setup',
        payload: { ...payload, hook_event_name: 'Setup' },
        matcherValue: trigger,
        io: { runHook },
        cwd: '/ws',
        warn: () => undefined,
      })
    await dispatch('init')
    expect(runHook).toHaveBeenCalledTimes(2)
    runHook.mockClear()
    await dispatch('maintenance')
    expect(runHook).toHaveBeenCalledTimes(1)
    expect(isSetupTriggerMatch(hooks[0]!, 'init')).toBe(true)
    expect(isSetupTriggerMatch(hooks[0]!, 'maintenance')).toBe(false)
    expect(isSetupTriggerMatch(hooks[1]!, 'maintenance')).toBe(true)
  })

  it('matches FileChanged paths against the hook glob', async () => {
    const hooks = parseSparkHooksConfig(
      spark({ FileChanged: [{ matcher: 'src/**', hooks: [{ type: 'command', command: 'w' }] }] }),
      'project',
      'linux',
    ).hooks
    const runHook = vi.fn(() => Promise.resolve(shellResult('', '', 0)))
    const dispatch = (value: string) =>
      dispatchExtensionHooks({
        hooks,
        event: 'FileChanged',
        payload,
        matcherValue: value,
        io: { runHook },
        cwd: '/ws',
        warn: () => undefined,
      })
    await dispatch('src/app.ts')
    expect(runHook).toHaveBeenCalledTimes(1)
    await dispatch('docs/notes.md')
    expect(runHook).toHaveBeenCalledTimes(1)
  })

  it('keeps the first refusal and takes the last rewrite', async () => {
    const hooks = parseSparkHooksConfig(
      spark({
        MessageDisplay: [
          {
            hooks: [
              { type: 'command', command: 'first' },
              { type: 'command', command: 'second' },
            ],
          },
        ],
      }),
      'project',
      'linux',
    ).hooks
    const runHook = vi.fn((command: string) =>
      Promise.resolve(shellResult(JSON.stringify({ displayText: `${command} version` }), '', 0)),
    )
    const result = await dispatchExtensionHooks({
      hooks,
      event: 'MessageDisplay',
      payload,
      io: { runHook },
      cwd: '/ws',
      warn: () => undefined,
    })
    expect(result.displayText).toBe('second version')
  })

  it('does not wait for an async hook', async () => {
    let isFinished = false
    const runHook = vi.fn(
      () =>
        new Promise<ReturnType<typeof shellResult>>((resolve) => {
          setTimeout(() => {
            isFinished = true
            resolve(shellResult('', '', 0))
          }, 20)
        }),
    )
    const hooks = parseSparkHooksConfig(
      spark({ Manual: [{ hooks: [{ type: 'command', command: 'slow', async: true }] }] }),
      'project',
      'linux',
    ).hooks
    const result = await dispatchExtensionHooks({
      hooks,
      event: 'Manual',
      payload,
      io: { runHook },
      cwd: '/ws',
      warn: () => undefined,
    })
    expect(isFinished).toBe(false)
    expect(result.messages).toEqual([])
  })

  it('starts no hook when the input exceeds the limit', async () => {
    const runHook = vi.fn(() => Promise.resolve(shellResult('', '', 0)))
    const warnings: string[] = []
    const result = await dispatchExtensionHooks({
      hooks: hookFor('Manual', 'run-me'),
      event: 'Manual',
      payload: { big: 'x'.repeat(300 * 1024) },
      io: { runHook },
      cwd: '/ws',
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(runHook).not.toHaveBeenCalled()
    expect(warnings).toEqual(['Manual: hook input exceeds limit; no hook was started'])
    expect(result.messages).toEqual([])
  })

  it('warns when no runner is available', async () => {
    const warnings: string[] = []
    await dispatchExtensionHooks({
      hooks: hookFor('Manual', 'run-me'),
      event: 'Manual',
      payload,
      io: {},
      cwd: '/ws',
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(warnings).toEqual(['Manual: hook runner is unavailable'])
  })

  it('runs onFailure when the command cannot start', async () => {
    const hooks = parseSparkHooksConfig(
      spark({
        Manual: [
          {
            hooks: [
              {
                type: 'command',
                command: 'missing',
                onFailure: { type: 'command', command: 'fallback' },
              },
            ],
          },
        ],
      }),
      'project',
      'linux',
    ).hooks
    const runHook = vi.fn((command: string) =>
      command === 'missing'
        ? Promise.reject(new Error('spawn ENOENT'))
        : Promise.resolve(shellResult(JSON.stringify({ systemMessage: 'fell back' }), '', 0)),
    )
    const warnings: string[] = []
    const result = await dispatchExtensionHooks({
      hooks,
      event: 'Manual',
      payload,
      io: { runHook },
      cwd: '/ws',
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(result.messages).toEqual(['fell back'])
    expect(warnings).toEqual(['Manual: extension hook could not start'])
  })

  it('lists Manual hooks for the Run Hook pick', () => {
    const hooks = parseSparkHooksConfig(
      spark({
        Manual: [{ hooks: [{ type: 'command', command: 'deploy' }] }],
        Setup: [{ hooks: [{ type: 'command', command: 'setup' }] }],
      }),
      'project',
      'linux',
    ).hooks
    expect(manualHooks(hooks).map((hook) => hook.command)).toEqual(['deploy'])
  })
})

describe('createFileChangedThrottle', () => {
  it('fires once per path in the quiet window', () => {
    const throttle = createFileChangedThrottle()
    expect(throttle.check('a.ts', 1000)).toBe('fire')
    expect(throttle.check('a.ts', 1200)).toBe('debounced')
    expect(throttle.check('b.ts', 1200)).toBe('fire')
    expect(throttle.check('a.ts', 2000)).toBe('fire')
  })

  it('caps the runs per minute and resumes in a new window', () => {
    const throttle = createFileChangedThrottle()
    for (let index = 0; index < 30; index += 1) {
      expect(throttle.check(`file-${String(index)}.ts`, 1000 + index)).toBe('fire')
    }
    expect(throttle.check('one-more.ts', 2000)).toBe('capped')
    expect(throttle.check('one-more.ts', 3000)).toBe('capped')
    expect(throttle.check('fresh.ts', 61_001 + 1000)).toBe('fire')
  })
})

describe('isToolAllowedBySelection', () => {
  it('allows everything without a narrowing and only listed tools with one', () => {
    expect(isToolAllowedBySelection('bash', undefined)).toBe(true)
    expect(isToolAllowedBySelection('bash', ['read_file'])).toBe(false)
    expect(isToolAllowedBySelection('read_file', ['read_file'])).toBe(true)
  })
})

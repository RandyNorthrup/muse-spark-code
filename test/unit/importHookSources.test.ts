// M91 round 2 (RVM91I): every importer finding has a regression here, with
// fixtures shaped as each vendor documents its file. The saved documents are
// in the session scratchpad's `hooks-parity/` folder; each fixture names its
// file and lines. Translated matchers are proved with Muse Code's own matcher
// engine (`parseHookConfig` and `matchingHooks`), never by string equality
// alone.

import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { mcpFunctionName } from '../../src/core/backends/modelapi/mcp/functions'
import { AGENT_IMPORT_CURSOR_EVENTS, EXTENSION_HOOK_EVENTS } from '../../src/shared/constants'
import {
  type HookDefinition,
  matchingHooks,
  parseHookConfig,
  toolMatcherNames,
} from '../../src/core/backends/modelapi/hooks'
import {
  clineEventForFile,
  convertClaudeSparkHook,
  convertClineHook,
  convertCodexHook,
  convertCopilotHook,
  convertCursorHook,
  convertGeminiHook,
  convertHook,
  convertKiroHook,
  copilotFlavorOf,
  type FoundHook,
  geminiSequentialEvents,
  hasDisableAllHooks,
  isCodexHooksOff,
  readClaudeHooks,
  readCopilotHooks,
  readCursorHooks,
  readGeminiSwitches,
  readKiroHooks,
  withSwitches,
} from '../../src/core/import/importConvert'

/** Whether a converted `matcher` selects this tool, by Muse Code's engine. */
function isAdmitted(matcher: unknown, tool: string): boolean {
  const config = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          ...(matcher !== undefined && { matcher }),
          hooks: [{ type: 'command', command: 'x' }],
        },
      ],
    },
  })
  const parsed = parseHookConfig(config, 'project', 'linux')
  expect(parsed.warnings).toEqual([])
  return matchingHooks(parsed.hooks, 'PreToolUse', toolMatcherNames(tool)).length > 0
}

/** Whether a source regex kept as a predicate (`commandPattern`, `pathPattern`) matches a value, by the same engine. */
function isPredicateMatch(pattern: unknown, value: string): boolean {
  expect(typeof pattern).toBe('string')
  const scoped: HookDefinition = {
    event: 'PreToolUse',
    source: 'project',
    command: '',
    timeoutSeconds: 0,
    isAsync: false,
    matcher: { kind: 'regex', pattern: String(pattern) },
  }
  return matchingHooks([scoped], 'PreToolUse', value).length > 0
}

function groupOf(
  converted: ReturnType<typeof convertCursorHook>,
): Readonly<Record<string, unknown>> {
  expect(converted.ok).toBe(true)
  return converted.ok ? converted.value.group : {}
}

function foreign(event: string, raw: unknown, extra: Partial<FoundHook> = {}): FoundHook {
  return { event, matcher: undefined, raw, ...extra }
}

function kiroOne(entry: Record<string, unknown>) {
  const read = readKiroHooks(JSON.stringify({ version: 'v1', hooks: [entry] }))
  expect(read.status).toBe('ok')
  if (read.status !== 'ok' || read.hooks[0] === undefined) {
    throw new Error('unreadable Kiro fixture')
  }
  return convertKiroHook(read.hooks[0])
}

// --- Finding 1: Kiro confirmation is never lost ---

describe('RVM91I-1 Kiro confirm', () => {
  // raw/kiro_hooks.md:104-120 (the saved example, verbatim shape).
  const submit = {
    name: 'Submit session results',
    trigger: 'Stop',
    action: { type: 'command', command: './submit.sh' },
    confirm: {
      question: "Submit this session's results?",
      options: [
        { id: 'submit', label: 'Yes, submit', run: true },
        { id: 'dismiss', label: 'Not this time', run: false },
      ],
    },
  }

  it('refuses a Stop hook that asks first, naming confirm', () => {
    expect(kiroOne(submit)).toEqual({ ok: false, reason: 'field', field: 'confirm' })
  })

  it('refuses a dynamic confirmCommand the same way (raw/kiro_hooks.md:127-138)', () => {
    expect(
      kiroOne({
        ...submit,
        confirm: { ...submit.confirm, confirmCommand: './confirm-options.sh' },
      }),
    ).toEqual({ ok: false, reason: 'field', field: 'confirm' })
  })

  it('converts the same hook without confirm', () => {
    const { confirm: _confirm, ...plain } = submit
    expect(kiroOne(plain)).toMatchObject({ ok: true, value: { event: 'Stop' } })
  })
})

// --- Finding 2: disabled source hooks stay disabled ---

describe('RVM91I-2 disabled in the source', () => {
  it('refuses Kiro enabled:false as disabled (raw/kiro_hooks.md:89)', () => {
    expect(
      kiroOne({
        name: 'off',
        trigger: 'PreToolUse',
        action: { type: 'command', command: 'guard' },
        enabled: false,
      }),
    ).toEqual({ ok: false, reason: 'disabled' })
  })

  // raw-codex-gemini.md:79: hooksConfig.enabled (default true), hooksConfig.disabled (names).
  const gemini = {
    hooksConfig: { enabled: true, disabled: ['audit'] },
    hooks: {
      BeforeTool: [
        {
          matcher: '^run_shell_command$',
          hooks: [
            { name: 'audit', type: 'command', command: 'audit.sh' },
            { name: 'guard', type: 'command', command: 'guard.sh' },
          ],
        },
      ],
    },
  }

  it('refuses a Gemini hook named in hooksConfig.disabled and keeps its sibling', () => {
    const text = JSON.stringify(gemini)
    const hooks = withSwitches(readClaudeHooks(text) ?? [], readGeminiSwitches(text))
    expect(hooks.map((hook) => convertGeminiHook(hook).ok)).toEqual([false, true])
    expect(convertGeminiHook(hooks[0]!)).toEqual({ ok: false, reason: 'disabled' })
  })

  it('refuses every Gemini hook when hooksConfig.enabled is false', () => {
    const text = JSON.stringify({ ...gemini, hooksConfig: { enabled: false } })
    const hooks = withSwitches(readClaudeHooks(text) ?? [], readGeminiSwitches(text))
    expect(hooks.map((hook) => convertGeminiHook(hook))).toEqual([
      { ok: false, reason: 'disabled' },
      { ok: false, reason: 'disabled' },
    ])
  })

  it('reads Codex [features] hooks = false and its alias (raw-codex-gemini.md:9)', () => {
    expect(isCodexHooksOff('[features]\nhooks = false\n')).toBe(true)
    expect(isCodexHooksOff('[features]\ncodex_hooks = false\n')).toBe(true)
    expect(isCodexHooksOff('[features]\nhooks = true\n')).toBe(false)
    expect(isCodexHooksOff('model = "x"\n')).toBe(false)
    const [hook] = withSwitches(
      [{ event: 'PreToolUse', matcher: 'Bash', raw: { type: 'command', command: 'guard' } }],
      { isOff: true },
    )
    expect(convertCodexHook(hook!)).toEqual({ ok: false, reason: 'disabled' })
  })

  it('refuses every entry of a Copilot file with disableAllHooks (gh/…hooks-configuration.md:862-875)', () => {
    const text = JSON.stringify({
      version: 1,
      disableAllHooks: true,
      hooks: { preToolUse: [{ type: 'command', bash: 'guard' }] },
    })
    expect(hasDisableAllHooks(text)).toBe(true)
    const read = readCopilotHooks(text)
    expect(read.status).toBe('ok')
    if (read.status === 'ok') {
      expect(convertCopilotHook(read.hooks[0]!)).toEqual({
        ok: false,
        reason: 'disabled',
      })
    }
  })

  it('refuses Claude Code hooks under disableAllHooks', () => {
    const text = JSON.stringify({
      disableAllHooks: true,
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'g' }] }] },
    })
    const hooks = withSwitches(readClaudeHooks(text) ?? [], { isOff: hasDisableAllHooks(text) })
    expect(convertHook(hooks[0]!)).toEqual({ ok: false, reason: 'disabled' })
  })
})

// --- Finding 3: Kiro prompt and agent-action filters are kept or refused ---

describe('RVM91I-3 Kiro filters', () => {
  // raw/kiro_ide_whats-new-v1_hooks.md:44-55: UserPromptSubmit matches prompt text.
  it('refuses a UserPromptSubmit prompt-text matcher rather than widening it', () => {
    expect(
      kiroOne({
        name: 'deploy-gate',
        trigger: 'UserPromptSubmit',
        matcher: '^deploy',
        action: { type: 'command', command: 'gate' },
      }),
    ).toEqual({ ok: false, reason: 'field', field: 'matcher' })
  })

  it('keeps an agent action’s file matcher and path pattern', () => {
    const group = groupOf(
      kiroOne({
        name: 'ts-review',
        trigger: 'PostFileSave',
        matcher: String.raw`\.(ts|tsx)$`,
        action: { type: 'agent', prompt: 'Review the change' },
      }),
    )
    expect(group).toMatchObject({
      matcher: 'Edit|Write',
      pathPattern: String.raw`\.(ts|tsx)$`,
      sourceEvent: 'PostFileSave',
      hooks: [{ type: 'prompt', prompt: 'Review the change' }],
    })
    expect(isPredicateMatch(group['pathPattern'], 'src/a.tsx')).toBe(true)
    expect(isPredicateMatch(group['pathPattern'], 'README.md')).toBe(false)
  })

  it('keeps an agent action’s tool matcher', () => {
    const group = groupOf(
      kiroOne({
        name: 'shell-review',
        trigger: 'PreToolUse',
        matcher: 'shell',
        action: { type: 'agent', prompt: 'Check the command' },
      }),
    )
    expect(isAdmitted(group['matcher'], 'bash')).toBe(true)
    expect(isAdmitted(group['matcher'], 'write_file')).toBe(false)
  })
})

// --- Finding 4: Cursor shell-command matchers stay command predicates ---

describe('RVM91I-4 Cursor beforeShellExecution matcher', () => {
  // cursor_com_docs_hooks_md.out:740-748, verbatim.
  const network = { command: './approve-network.sh', matcher: 'curl|wget|nc ' }

  it('keeps the shell tool matcher and the command-text predicate apart', () => {
    const group = groupOf(convertCursorHook(foreign('beforeShellExecution', network)))
    expect(group).toMatchObject({ matcher: 'Bash', commandPattern: 'curl|wget|nc ' })
    expect(isAdmitted(group['matcher'], 'bash')).toBe(true)
    expect(isAdmitted(group['matcher'], 'read_file')).toBe(false)
    expect(isPredicateMatch(group['commandPattern'], 'curl https://example.com')).toBe(true)
    expect(isPredicateMatch(group['commandPattern'], 'ls -la')).toBe(false)
  })
})

// --- Finding 5: source event and flavor survive ---

describe('RVM91I-5 source identity', () => {
  it('keeps Cursor generic preToolUse and specialised beforeShellExecution distinct', () => {
    const generic = groupOf(
      convertCursorHook(foreign('preToolUse', { command: './v.sh', matcher: 'Shell' })),
    )
    const special = groupOf(
      convertCursorHook(foreign('beforeShellExecution', { command: './v.sh' })),
    )
    expect(generic).toMatchObject({
      format: 'cursor',
      sourceEvent: 'preToolUse',
    })
    expect(special).toMatchObject({
      format: 'cursor',
      sourceEvent: 'beforeShellExecution',
    })
    expect(generic).not.toEqual(special)
  })

  it('keeps Copilot camelCase, PascalCase and VS Code Local apart', () => {
    const camel = groupOf(convertCopilotHook(foreign('preToolUse', { type: 'command', bash: 'g' })))
    const pascal = groupOf(
      convertCopilotHook(foreign('PreToolUse', { type: 'command', bash: 'g' })),
    )
    const local = groupOf(
      convertCopilotHook(foreign('PreToolUse', { type: 'command', command: 'g' }), 'vscode'),
    )
    expect(camel).toMatchObject({ sourceEvent: 'preToolUse', flavor: 'copilot' })
    expect(pascal).toMatchObject({ sourceEvent: 'PreToolUse', flavor: 'copilot' })
    expect(local).toMatchObject({ sourceEvent: 'PreToolUse', flavor: 'vscode' })
    expect(copilotFlavorOf('PreToolUse', false, false)).toBe('vscode')
    expect(copilotFlavorOf('PreToolUse', true, false)).toBe('copilot')
    expect(copilotFlavorOf('PreToolUse', false, true)).toBe('copilot')
  })

  it('keeps Kiro PostFileCreate, PostFileSave and PostFileDelete distinct', () => {
    const events = ['PostFileCreate', 'PostFileSave', 'PostFileDelete'].map(
      (trigger) =>
        groupOf(kiroOne({ name: trigger, trigger, action: { type: 'command', command: 'x' } }))[
          'sourceEvent'
        ],
    )
    expect(events).toEqual(['PostFileCreate', 'PostFileSave', 'PostFileDelete'])
  })

  it('keeps the source entry verbatim beside the converted hook', () => {
    const raw = { command: './v.sh', matcher: 'Shell', failClosed: true }
    expect(groupOf(convertCursorHook(foreign('preToolUse', raw)))['sourceEntry']).toEqual(raw)
  })
})

// --- Finding 7: tool matchers translate exactly or are refused ---

describe('RVM91I-7 matcher translation', () => {
  it('maps Copilot edit to Edit (gh/…hooks-configuration.md:737-746, 838-849)', () => {
    const group = groupOf(
      convertCopilotHook(
        foreign('preToolUse', { type: 'command', bash: 'g', matcher: 'bash|edit' }),
      ),
    )
    expect(isAdmitted(group['matcher'], 'edit_file')).toBe(true)
    expect(isAdmitted(group['matcher'], 'bash')).toBe(true)
    expect(isAdmitted(group['matcher'], 'powershell')).toBe(false)
    expect(isAdmitted(group['matcher'], 'read_file')).toBe(false)
  })

  it('maps Kiro read to Read and keeps ^fs_write$ grouped (raw/kiro_hooks_types.md:153-167)', () => {
    const read = groupOf(
      kiroOne({
        name: 'r',
        trigger: 'PreToolUse',
        matcher: 'read',
        action: { type: 'command', command: 'x' },
      }),
    )
    expect(isAdmitted(read['matcher'], 'read_file')).toBe(true)
    const write = groupOf(
      kiroOne({
        name: 'w',
        trigger: 'PreToolUse',
        matcher: '^fs_write$',
        action: { type: 'command', command: 'x' },
      }),
    )
    expect(isAdmitted(write['matcher'], 'write_file')).toBe(true)
    expect(isAdmitted(write['matcher'], 'edit_file')).toBe(true)
    expect(isAdmitted(write['matcher'], 'bash')).toBe(false)
    expect(isAdmitted(write['matcher'], 'Writer')).toBe(false)
  })

  it('refuses Gemini partial and unanchored names that cannot preserve MCP admission', () => {
    for (const matcher of ['read_', 'read_file']) {
      expect(
        convertGeminiHook({
          event: 'BeforeTool',
          matcher,
          raw: { type: 'command', command: 'x' },
          group: { matcher },
        }),
      ).toEqual({ ok: false, reason: 'field', field: 'matcher' })
    }
  })

  it('refuses an ambiguous Gemini MCP name and keeps underscores in an anchored one', () => {
    const ambiguous = convertGeminiHook({
      event: 'BeforeTool',
      matcher: 'mcp_my_server_search_tool',
      raw: { type: 'command', command: 'x' },
      group: { matcher: 'mcp_my_server_search_tool' },
    })
    expect(ambiguous).toEqual({ ok: false, reason: 'field', field: 'matcher' })
    const anchored = groupOf(
      convertGeminiHook({
        event: 'BeforeTool',
        matcher: '^mcp_github_search$',
        raw: { type: 'command', command: 'x' },
        group: { matcher: '^mcp_github_search$' },
      }),
    )
    expect(anchored['matcher']).toBe('mcp__github__search')
    expect(isAdmitted(anchored['matcher'], 'mcp__github__search')).toBe(true)
  })

  it('keeps a Codex regex anchored on both names', () => {
    const converted = convertCodexHook({
      event: 'PreToolUse',
      matcher: '^apply_patch$',
      raw: { type: 'command', command: 'g' },
    })
    expect(converted).toMatchObject({ ok: true, value: { group: { matcher: '^(?:Edit|Write)$' } } })
    const matcher = converted.ok ? converted.value.group['matcher'] : undefined
    expect(isAdmitted(matcher, 'edit_file')).toBe(true)
    expect(isAdmitted(matcher, 'write_file')).toBe(true)
    expect(isAdmitted(matcher, 'Editor')).toBe(false)
  })

  it('translates a Cursor generic matcher over built-in and MCP names', () => {
    // cursor_com_docs_hooks_md.out:668-673 (preToolUse "Shell|Read|Write").
    const group = groupOf(
      convertCursorHook(foreign('preToolUse', { command: './v.sh', matcher: 'Shell|Read|Write' })),
    )
    for (const tool of ['bash', 'powershell', 'read_file', 'write_file', 'edit_file']) {
      expect(isAdmitted(group['matcher'], tool)).toBe(true)
    }
    expect(isAdmitted(group['matcher'], 'search')).toBe(false)
    expect(isAdmitted(group['matcher'], 'mcp__fs__ReadFile')).toBe(true)
  })
})

// --- Findings 8 and 9: Cline scripts by Cline's own rules ---

describe('RVM91I-8/9 Cline scripts', () => {
  it.each(['TaskStart', 'TaskResume', 'TaskCancel', 'TaskComplete'])(
    'converts the %s lifecycle script once, keeping its name',
    (script) => {
      const kind = clineEventForFile(script, 'linux')
      expect(kind).toEqual({ kind: 'event', sourceEvent: script })
      const converted =
        kind.kind === 'event'
          ? convertClineHook(kind.sourceEvent, `/ws/.clinerules/hooks/${script}`)
          : undefined
      expect(converted).toMatchObject({
        ok: true,
        value: { group: { format: 'cline', sourceEvent: script } },
      })
    },
  )

  // cline-hooks-901d1b5c97.mdx:166-172.
  it.each([
    ['PreToolUse', 'linux', true],
    ['PreToolUse.sh', 'linux', false],
    ['PreToolUse.ps1', 'linux', false],
    ['PreToolUse.md', 'darwin', false],
    ['PreToolUse.ps1', 'win32', true],
    ['PreToolUse', 'win32', false],
  ] as const)('discovers %s on %s: %s', (name, platform, isEvent) => {
    expect(clineEventForFile(name, platform).kind === 'event').toBe(isEvent)
  })

  it('refuses a script Cline would not run (no execute bit) as disabled', () => {
    expect(convertClineHook('PreToolUse', '/ws/.clinerules/hooks/PreToolUse', false)).toEqual({
      ok: false,
      reason: 'disabled',
    })
  })
})

// --- Finding 10: Kiro's real timeout ---

describe('RVM91I-10 Kiro hooks[].timeout', () => {
  const base = { name: 't', trigger: 'PreToolUse', action: { type: 'command', command: 'g' } }

  it('keeps hooks[].timeout, writes the 60 s default, and refuses 0 (raw/kiro_hooks.md:88)', () => {
    expect(groupOf(kiroOne({ ...base, timeout: 3 }))['hooks']).toEqual([
      { type: 'command', command: 'g', timeout: 3 },
    ])
    expect(groupOf(kiroOne(base))['hooks']).toEqual([
      { type: 'command', command: 'g', timeout: 60 },
    ])
    expect(kiroOne({ ...base, timeout: 0 })).toEqual({
      ok: false,
      reason: 'field',
      field: 'timeout',
    })
    expect(kiroOne({ ...base, timeout: 601 })).toEqual({
      ok: false,
      reason: 'field',
      field: 'timeout',
    })
  })
})

// --- Finding 11: Gemini sequential groups ---

describe('RVM91I-11 Gemini sequential', () => {
  it('refuses every hook of an event whose group runs in order (raw-codex-gemini.md:77)', () => {
    const text = JSON.stringify({
      hooks: {
        BeforeTool: [
          {
            matcher: 'write_file',
            sequential: true,
            hooks: [
              { type: 'command', command: 'make-policy' },
              { type: 'command', command: 'check-policy' },
            ],
          },
        ],
        AfterTool: [{ hooks: [{ type: 'command', command: 'log' }] }],
      },
    })
    const hooks = readClaudeHooks(text) ?? []
    const sequential = geminiSequentialEvents(hooks)
    expect(hooks.map((hook) => convertGeminiHook(hook, sequential))).toEqual([
      { ok: false, reason: 'field', field: 'sequential' },
      { ok: false, reason: 'field', field: 'sequential' },
      expect.objectContaining({ ok: true }),
    ])
  })
})

// --- Finding 12: documented schema variants ---

describe('RVM91I-12 schema variants', () => {
  it('accepts Cursor type:"command" (cursor_com_docs_hooks_md.out:703-708)', () => {
    expect(
      convertCursorHook(
        foreign('stop', { type: 'command', command: './audit.sh', loop_limit: 10 }),
      ),
    ).toMatchObject({ ok: true, value: { event: 'Stop', group: { loop_limit: 10 } } })
  })

  it('takes Copilot’s command fallback and timeout alias (gh/…hooks-configuration.md:120-131)', () => {
    const group = groupOf(
      convertCopilotHook(foreign('postToolUse', { type: 'command', command: 'log', timeout: 12 })),
    )
    expect(group['hooks']).toEqual([{ type: 'command', command: 'log', timeout: 12 }])
    const both = groupOf(
      convertCopilotHook(
        foreign('postToolUse', { command: 'x', powershell: 'x.ps1', timeoutSec: 5, timeout: 9 }),
      ),
    )
    expect(both['hooks']).toEqual([
      { type: 'command', command: 'x', commandWindows: 'x.ps1', timeout: 5 },
    ])
    expect(groupOf(convertCopilotHook(foreign('postToolUse', { bash: 'x' })))['hooks']).toEqual([
      { type: 'command', command: 'x', timeout: 30 },
    ])
  })

  it('reads VS Code Local command, windows, linux, osx and timeout (vsc/hooks-reference.md:33-62)', () => {
    const group = groupOf(
      convertCopilotHook(
        foreign('PreToolUse', {
          type: 'command',
          command: './scripts/validate-tool.sh',
          windows: String.raw`powershell -File scripts\validate-tool.ps1`,
          timeout: 15,
        }),
        'vscode',
      ),
    )
    expect(group['hooks']).toEqual([
      {
        type: 'command',
        command: './scripts/validate-tool.sh',
        commandWindows: String.raw`powershell -File scripts\validate-tool.ps1`,
        timeout: 15,
      },
    ])
    expect(
      convertCopilotHook(
        foreign('PreToolUse', { type: 'command', linux: 'a', osx: 'b' }),
        'vscode',
      ),
    ).toEqual({ ok: false, reason: 'field', field: 'linux' })
  })

  it('maps the PascalCase aliases UserPromptSubmit and Stop', () => {
    for (const [event, ours] of [
      ['UserPromptSubmit', 'UserPromptSubmit'],
      ['Stop', 'Stop'],
      ['ErrorOccurred', 'StopFailure'],
    ] as const) {
      expect(convertCopilotHook(foreign(event, { type: 'command', bash: 'x' }))).toMatchObject({
        ok: true,
        value: { event: ours, group: { sourceEvent: event, flavor: 'copilot' } },
      })
    }
    expect(convertCopilotHook(foreign('PRETOOLUSE', { bash: 'x' }))).toEqual({
      ok: false,
      reason: 'unmapped',
    })
  })

  it('refuses exec, args and env by name', () => {
    for (const field of ['exec', 'env']) {
      expect(
        convertCopilotHook(
          foreign('preToolUse', { type: 'command', [field]: field === 'env' ? {} : 'x' }),
        ),
      ).toEqual({ ok: false, reason: 'field', field })
    }
  })
})

// --- Finding 13: adopted concepts are no longer refused ---

describe('RVM91I-13 adopted events', () => {
  it.each([
    ['Setup', 'init'],
    ['DirectoryAdded', undefined],
    ['CwdChanged', undefined],
    ['Elicitation', 'my_server'],
    ['ElicitationResult', undefined],
    ['TeammateIdle', undefined],
    ['MessageDisplay', undefined],
  ])('carries Claude %s into spark-hooks.json', (event, matcher) => {
    expect(
      convertClaudeSparkHook({ event, matcher, raw: { type: 'command', command: 'x' } }),
    ).toMatchObject({ ok: true, value: { event } })
  })

  it('refuses a Claude Setup matcher outside init and maintenance', () => {
    expect(
      convertClaudeSparkHook({
        event: 'Setup',
        matcher: 'boot',
        raw: { type: 'command', command: 'x' },
      }),
    ).toEqual({ ok: false, reason: 'field', field: 'matcher' })
  })

  // M91 lane W: imported hooks on the extension events wait for M91b's
  // adapter route there (PLAN.md M91b). Cursor workspaceOpen and
  // afterAgentThought (cursor_com_docs_hooks_md.out:686-690) only observe.
  it('refuses Cursor workspaceOpen and afterAgentThought as unsupported until M91b', () => {
    expect(convertCursorHook(foreign('workspaceOpen', { command: './r.sh' }))).toEqual({
      ok: false,
      reason: 'unsupported',
    })
    expect(convertCursorHook(foreign('afterAgentThought', { command: './t.sh' }))).toEqual({
      ok: false,
      reason: 'unsupported',
    })
  })

  it('refuses Kiro Manual without its adapter, and Gemini BeforeToolSelection as weaker', () => {
    expect(
      kiroOne({ name: 'hand', trigger: 'Manual', action: { type: 'command', command: 'run' } }),
    ).toEqual({ ok: false, reason: 'unmapped' })
    // It narrows the tools where it came from: here it would not, yet.
    expect(
      convertGeminiHook({
        event: 'BeforeToolSelection',
        matcher: undefined,
        raw: { type: 'command', command: 'pick' },
        group: {},
      }),
    ).toEqual({ ok: false, reason: 'weaker' })
  })

  it('refuses Kiro PreTaskExec as weaker and PostTaskExec as unsupported until M91b', () => {
    // PreTaskExec blocks on exit 2 in Kiro; PostTaskExec only observes.
    expect(
      kiroOne({ name: 'pre', trigger: 'PreTaskExec', action: { type: 'command', command: 'c' } }),
    ).toEqual({ ok: false, reason: 'weaker' })
    expect(
      kiroOne({ name: 'post', trigger: 'PostTaskExec', action: { type: 'command', command: 'c' } }),
    ).toEqual({ ok: false, reason: 'unsupported' })
  })
})

// --- Cursor files keep their per-entry fields ---

describe('Cursor fixed-subject matchers', () => {
  it('decides beforeReadFile’s matcher against Read: runs always, or refuses', () => {
    expect(
      convertCursorHook(foreign('beforeReadFile', { command: './r.sh', matcher: 'Read' })),
    ).toMatchObject({ ok: true, value: { group: { matcher: 'Read' } } })
    expect(
      convertCursorHook(foreign('beforeReadFile', { command: './r.sh', matcher: 'Shell' })),
    ).toEqual({
      ok: false,
      reason: 'field',
      field: 'matcher',
    })
  })

  it('reads a versioned Cursor file and names a newer version', () => {
    expect(readCursorHooks(JSON.stringify({ version: 2, hooks: {} }))).toEqual({
      status: 'unknownFormat',
    })
  })
})

// RVM91I2 source contracts: hooks-parity/gemini/hooks-reference.md:30,79-90;
// gh/copilot_reference_hooks-configuration.md:426-448; raw/kiro_hooks.md:84.
describe('RVM91I2 exact admission and records', () => {
  it('R2-3 quotes Cline shell metacharacters and spaces as one literal path', () => {
    const path = "/missing/space ' $(printf R2_PATH_EVALUATED >&2)/.clinerules/hooks/PreToolUse"
    const group = groupOf(convertClineHook('PreToolUse', path))
    expect(group['sourceEntry']).toEqual({ path })
    const parsed = parseHookConfig(
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: group['hooks'] }] } }),
      'project',
      'linux',
    )
    const command = parsed.hooks[0]?.command
    expect(command).toBeDefined()
    expect(parsed.hooks[0]?.timeoutSeconds).toBe(30)
    const run = spawnSync(
      process.platform === 'win32' ? 'bash' : '/bin/sh',
      ['-c', command ?? ''],
      { encoding: 'utf8' },
    )
    expect(run.status).not.toBe(0)
    // A shell error must name the whole literal path; no command substitution runs.
    expect(run.stderr).toContain(path)
    expect(run.stderr.split('\n')).not.toContain('R2_PATH_EVALUATED')
    const windows = parseHookConfig(
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: group['hooks'] }] } }),
      'project',
      'win32',
    )
    expect(windows.hooks[0]?.command).toBe(`& '${path.replaceAll("'", "''")}'`)
  })

  it('R2-5g refuses unanchored Gemini read_file rather than widening underscores', () => {
    expect(
      convertGeminiHook(
        foreign(
          'BeforeTool',
          { type: 'command', command: 'guard' },
          { matcher: 'read_file', group: { matcher: 'read_file' } },
        ),
      ),
    ).toEqual({ ok: false, reason: 'field', field: 'matcher' })
    const exact = groupOf(
      convertGeminiHook(
        foreign(
          'BeforeTool',
          { type: 'command', command: 'guard' },
          { matcher: '^read_file$', group: { matcher: '^read_file$' } },
        ),
      ),
    )
    expect(isAdmitted(exact['matcher'], 'read_file')).toBe(true)
    expect(isAdmitted(exact['matcher'], 'mcp__fs__read__file')).toBe(false)
  })

  it('R2-5c preserves the difference between Copilot literal aliases and regex subjects', () => {
    expect(convertCopilotHook(foreign('PreToolUse', { bash: 'guard', matcher: '^edit$' }))).toEqual(
      { ok: false, reason: 'field', field: 'matcher' },
    )
    const literal = groupOf(
      convertCopilotHook(foreign('PreToolUse', { bash: 'guard', matcher: 'edit' })),
    )
    const regex = groupOf(
      convertCopilotHook(foreign('PreToolUse', { bash: 'guard', matcher: '^Edit$' })),
    )
    expect(isAdmitted(literal['matcher'], 'edit_file')).toBe(true)
    expect(isAdmitted(regex['matcher'], 'edit_file')).toBe(true)
  })

  it('R2-5k refuses an anchored Kiro server-only selector and keeps tool anchors', () => {
    const action = { type: 'command', command: 'guard' }
    const hook = (matcher: string) =>
      kiroOne({
        name: 'guard',
        trigger: 'PreToolUse',
        matcher,
        action,
      })
    for (const matcher of ['^@mcp$', '^@builtin$', '^@powers$'])
      expect(hook(matcher)).toEqual({ ok: false, reason: 'field', field: 'matcher' })
    expect(hook('^@git$')).toEqual({ ok: false, reason: 'field', field: 'matcher' })
    const exact = groupOf(hook('^@git/status$'))
    expect(isAdmitted(exact['matcher'], 'mcp__git__status')).toBe(true)
    expect(isAdmitted(exact['matcher'], 'mcp__git__statusExtra')).toBe(false)
    expect(isAdmitted(exact['matcher'], 'mcp__github__status')).toBe(false)
    const prefix = groupOf(hook('@git'))
    expect(isAdmitted(prefix['matcher'], 'mcp__github__status')).toBe(true)
  })

  it.each([
    ['SessionStart', '^startup$'],
    ['SessionStart', '.*'],
    ['SessionEnd', 'logout'],
    ['PreCompress', '^manual$'],
  ])('R2-6 refuses Gemini exact lifecycle %s filter %s', (event, matcher) => {
    const [hook] =
      readClaudeHooks(
        JSON.stringify({
          hooks: { [event]: [{ matcher, hooks: [{ type: 'command', command: 'guard' }] }] },
        }),
      ) ?? []
    expect(hook).toBeDefined()
    expect(convertGeminiHook(hook!)).toEqual({ ok: false, reason: 'field', field: 'matcher' })
  })

  it('R2-6 keeps a supported Gemini lifecycle exact string', () => {
    expect(
      convertGeminiHook(
        foreign(
          'SessionStart',
          { type: 'command', command: 'guard' },
          { matcher: 'startup', group: { matcher: 'startup' } },
        ),
      ),
    ).toMatchObject({ ok: true, value: { group: { matcher: 'startup' } } })
  })

  it('R2-7 refuses MCP identities truncated by the real Muse name builder', () => {
    const server = 'abcdefghijklmnopqrstuvwxy'
    expect(mcpFunctionName(server, 'read', new Set())).toBe('mcp__abcdefghijklmnopqrst__read')
    const matcher = `^mcp_${server}_read$`
    expect(
      convertGeminiHook(
        foreign(
          'BeforeTool',
          { type: 'command', command: 'guard' },
          { matcher, group: { matcher } },
        ),
      ),
    ).toEqual({ ok: false, reason: 'field', field: 'matcher' })
    expect(
      kiroOne({
        name: 'guard',
        trigger: 'PreToolUse',
        matcher: `@${server}`,
        action: { type: 'command', command: 'guard' },
      }),
    ).toEqual({ ok: false, reason: 'field', field: 'matcher' })
    const safe = groupOf(
      convertGeminiHook(
        foreign(
          'BeforeTool',
          { type: 'command', command: 'guard' },
          { matcher: '^mcp_fs_read$', group: { matcher: '^mcp_fs_read$' } },
        ),
      ),
    )
    expect(isAdmitted(safe['matcher'], mcpFunctionName('fs', 'read', new Set()))).toBe(true)
  })

  // P d8e609aa engine.selectRow requires flavor equality. Cursor rows have
  // no flavor/defaultFlavor; sourceEvent alone identifies all eighteen rows.
  it('R2-8 emits every Cursor adapter source event without an incompatible flavor', () => {
    const extensionEvents: ReadonlySet<string> = new Set(EXTENSION_HOOK_EVENTS)
    for (const [event, mapped] of Object.entries(AGENT_IMPORT_CURSOR_EVENTS)) {
      const converted = convertCursorHook(foreign(event, { command: 'guard' }))
      // The extension events wait for M91b (lane W); every other row emits.
      if (extensionEvents.has(mapped)) {
        expect(converted).toEqual({ ok: false, reason: 'unsupported' })
        continue
      }
      expect(converted.ok).toBe(true)
      if (!converted.ok) {
        continue
      }

      expect(converted.value.event).toBe(mapped)
      expect(converted.value.group['sourceEvent']).toBe(event)
      expect(converted.value.group).not.toHaveProperty('flavor')
    }
  })

  it('R2-8 refuses Kiro Manual while the pinned adapter has no row', () => {
    expect(
      kiroOne({ name: 'manual', trigger: 'Manual', action: { type: 'command', command: 'guard' } }),
    ).toEqual({ ok: false, reason: 'unmapped' })
  })

  it.each(['PreToolUse', 'PermissionRequest'])(
    'R2-10 accepts universal Copilot regexes on %s',
    (event) => {
      for (const matcher of ['.*', '^.*$']) {
        const group = groupOf(convertCopilotHook(foreign(event, { bash: 'guard', matcher })))
        for (const tool of ['edit_file', 'bash', 'mcp__fs__read'])
          expect(isAdmitted(group['matcher'], tool)).toBe(true)
      }
    },
  )

  // cursor_com_docs_hooks_md.out:694-699 requires numeric version 1.
  it('R2-11 requires Cursor version without changing Copilot Local discovery', () => {
    const text = JSON.stringify({ hooks: { preToolUse: [{ command: 'guard' }] } })
    expect(readCursorHooks(text)).toEqual({ status: 'unknownFormat' })
    expect(
      readCursorHooks(
        JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: 'guard' }] } }),
      ),
    ).toMatchObject({ status: 'ok' })
    expect(readCopilotHooks(text)).toMatchObject({ status: 'ok', isVersioned: false })
  })
})

describe('RVM91I2 Gemini adapter tool names', () => {
  // P d8e609aa captured Gemini 0.62.0: search -> grep_search,
  // list_files -> list_directory. Legacy names cannot preserve exact filters.
  it('R2-5g refuses legacy exact aliases absent from the captured adapter vocabulary', () => {
    const legacy = ['^grep$', '^search_file_content$', '^ls$'].map((matcher) =>
      convertGeminiHook({
        event: 'BeforeTool',
        matcher,
        group: { matcher },
        raw: { type: 'command', command: 'guard' },
      }),
    )
    expect(legacy).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, reason: 'field', field: 'matcher' })),
    )
    const current = groupOf(
      convertGeminiHook(
        foreign(
          'BeforeTool',
          { type: 'command', command: 'guard' },
          { matcher: '^grep_search$', group: { matcher: '^grep_search$' } },
        ),
      ),
    )
    expect(isAdmitted(current['matcher'], 'search')).toBe(true)
  })
})

describe('RVM91I2 bounded names and shared native converter', () => {
  it('R2-7 refuses full MCP names that require Muse hash truncation', () => {
    const tool = 'a'.repeat(60)
    const plain = `mcp__fs__${tool}`
    expect(mcpFunctionName('fs', tool, new Set())).not.toBe(plain)
    const matcher = `^mcp_fs_${tool}$`
    const gemini = convertGeminiHook(
      foreign('BeforeTool', { type: 'command', command: 'guard' }, { matcher, group: { matcher } }),
    )
    const kiro = kiroOne({
      name: 'guard',
      trigger: 'PreToolUse',
      matcher: `^@fs/${tool}$`,
      action: { type: 'command', command: 'guard' },
    })
    expect(gemini).toEqual({ ok: false, reason: 'field', field: 'matcher' })
    expect(kiro).toEqual({ ok: false, reason: 'field', field: 'matcher' })
  })

  it('R2-gates retains separate Claude and Codex handler field admission', () => {
    const hook = foreign('PostToolUse', {
      type: 'command',
      command: 'fmt',
      commandWindows: 'fmt.ps1',
    })
    expect(convertHook(hook)).toEqual({ ok: false, reason: 'unsupported' })
    expect(convertCodexHook(hook)).toMatchObject({
      ok: true,
      value: { group: { hooks: [{ command: 'fmt', commandWindows: 'fmt.ps1' }] } },
    })
  })
})

// M91 lane H: the `http` hook handler (PLAN.md D70). User scope only, HTTPS
// only, a machine-scoped allowlist (exact hosts or `*.example.com` for
// subdomains only, no IP literals except loopback), only while the network
// posture allows, no redirects, the same bounded payload and answer schema
// as a command, and fixed headers with no credential names.

import { describe, expect, it, vi } from 'vitest'
import {
  dispatchHooks,
  parseHookConfig,
  type HookDefinition,
} from '../../src/core/backends/modelapi/hooks'
import {
  hookHttpHeaders,
  isHttpHostAllowed,
  isLoopbackLiteral,
  runHttpHandler,
  runTypedHandler,
  type HookHttpResult,
  type HookHttpPost,
  type TypedHookHandlers,
} from '../../src/core/backends/modelapi/hookHandlers'
import { UI_TEXT, HOOK_STDIN_MAX_BYTES } from '../../src/shared/constants'

function httpHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    event: 'PreToolUse',
    source: 'user',
    type: 'http',
    command: '',
    httpUrl: 'https://hooks.example.com/hook',
    timeoutSeconds: 5,
    matcher: undefined,
    isAsync: false,
    ...overrides,
  }
}

function handlers(overrides: Partial<TypedHookHandlers> = {}): TypedHookHandlers {
  return {
    httpPost: () => Promise.resolve({ status: 200, headers: {}, bodyText: '{}' }),
    httpAllowlist: () => ['hooks.example.com'],
    isNetworkAllowed: () => true,
    ...overrides,
  }
}

function hosted(text: string): HookHttpResult {
  return { status: 200, headers: {}, bodyText: text }
}

const parseAnswer = (stdout: string) =>
  stdout === '{"decision":"block","reason":"no"}'
    ? { status: 'blocked' as const, reason: 'no' }
    : { status: 'completed' as const, context: stdout === '{}' ? undefined : stdout }

function plainHttpUrl(): string {
  const url = new URL('https://hooks.example.com/hook')
  url.protocol = 'http:'
  return url.href
}

function runSimpleHttp(post: HookHttpPost, warn: (message: string) => void) {
  return runHttpHandler(
    {
      type: 'http',
      event: 'PreToolUse',
      source: 'user',
      httpUrl: 'https://hooks.example.com/hook',
    },
    JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/ws' }),
    { httpPost: post },
    handlers(),
    new AbortController().signal,
    warn,
    (_event, _exit, stdout) => parseAnswer(stdout),
  )
}

describe('http handler config (M91 D70)', () => {
  it("refuses managed HTTP handlers and another handler type's fields", () => {
    for (const entry of [
      { type: 'http', url: 'https://hooks.example.com/h', prompt: 'x' },
      { type: 'mcp_tool', server: 'docs', tool: 'lookup', url: 'https://hooks.example.com/h' },
    ]) {
      expect(
        parseHookConfig(
          JSON.stringify({ hooks: { PreToolUse: [{ hooks: [entry] }] } }),
          'user',
          'linux',
        ).hooks,
      ).toEqual([])
    }
    expect(
      parseHookConfig(
        JSON.stringify({
          hooks: {
            PreToolUse: [{ hooks: [{ type: 'http', url: 'https://hooks.example.com/h' }] }],
          },
        }),
        'managed',
        'linux',
      ).hooks,
    ).toEqual([])
  })
  it('parses an https http handler from a user file', () => {
    const parsed = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'http', url: 'https://hooks.example.com/hook', timeout: 5 }] },
          ],
        },
      }),
      'user',
      'linux',
    )
    expect(parsed.warnings).toEqual([])
    expect(parsed.hooks).toMatchObject([
      {
        event: 'PreToolUse',
        source: 'user',
        type: 'http',
        httpUrl: 'https://hooks.example.com/hook',
      },
    ])
  })

  it('refuses http in project files, plain HTTP, and bad urls', () => {
    const project = parseHookConfig(
      JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: 'http', url: 'https://hooks.example.com/h' }] }] },
      }),
      'project',
      'linux',
    )
    expect(project.hooks).toEqual([])
    expect(project.warnings.join(' ')).toContain('only from your own files')

    for (const url of [plainHttpUrl(), 'notaurl', '']) {
      const parsed = parseHookConfig(
        JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'http', url }] }] } }),
        'user',
        'linux',
      )
      expect(parsed.hooks).toEqual([])
      expect(parsed.warnings).toHaveLength(1)
    }
  })

  it('refuses mixed handler fields and unknown types', () => {
    const mixed = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'guard', url: 'https://hooks.example.com/h' }] },
          ],
        },
      }),
      'user',
      'linux',
    )
    expect(mixed.hooks).toEqual([])
    expect(mixed.warnings.join(' ')).toContain('takes no url')

    const typed = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'http', url: 'https://hooks.example.com/h', command: 'guard' }] },
          ],
        },
      }),
      'user',
      'linux',
    )
    expect(typed.hooks).toEqual([])
    expect(typed.warnings.join(' ')).toContain('takes no command field')

    const unknown = parseHookConfig(
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'sms', command: 'x' }] }] } }),
      'user',
      'linux',
    )
    expect(unknown.hooks).toEqual([])
    expect(unknown.warnings.join(' ')).toContain('must be one of')
  })

  it('parses mcp_tool and prompt/agent fields, and limits prompt/agent events', () => {
    const parsed = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [
                { type: 'mcp_tool', server: 'lint', tool: 'check' },
                { type: 'prompt', prompt: 'Is this safe?' },
              ],
            },
          ],
          Stop: [{ hooks: [{ type: 'agent', prompt: 'Summarize.' }] }],
          SessionStart: [{ hooks: [{ type: 'agent', prompt: 'Summarize.' }] }],
        },
      }),
      'user',
      'linux',
    )
    expect(parsed.hooks).toMatchObject([
      { type: 'mcp_tool', mcpServer: 'lint', mcpTool: 'check' },
      { type: 'prompt', modelPrompt: 'Is this safe?' },
      { type: 'agent', modelPrompt: 'Summarize.' },
    ])
    expect(parsed.warnings.join(' ')).toContain('agent handler cannot run on SessionStart')

    const nameless = parseHookConfig(
      JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: 'mcp_tool', server: 'lint' }] }] },
      }),
      'user',
      'linux',
    )
    expect(nameless.hooks).toEqual([])
  })
})

describe('http allowlist matching (M91 D70)', () => {
  it('matches exact hosts, case-insensitively, with a trailing dot', () => {
    expect(isHttpHostAllowed('hooks.example.com', ['hooks.example.com'])).toBe(true)
    expect(isHttpHostAllowed('HOOKS.EXAMPLE.COM', ['hooks.example.com'])).toBe(true)
    expect(isHttpHostAllowed('hooks.example.com.', ['hooks.example.com'])).toBe(true)
    expect(isHttpHostAllowed('other.example.com', ['hooks.example.com'])).toBe(false)
    expect(isHttpHostAllowed('hooks.example.com.evil.com', ['hooks.example.com'])).toBe(false)
  })

  it('matches subdomains only for wildcard entries, never the bare domain', () => {
    const allowlist = ['*.example.com']
    expect(isHttpHostAllowed('hooks.example.com', allowlist)).toBe(true)
    expect(isHttpHostAllowed('deep.hooks.example.com', allowlist)).toBe(true)
    expect(isHttpHostAllowed('example.com', allowlist)).toBe(false)
    expect(isHttpHostAllowed('notexample.com', allowlist)).toBe(false)
    expect(isHttpHostAllowed('example.com.evil.com', allowlist)).toBe(false)
  })

  it('refuses IP literals except loopback, which still needs its entry', () => {
    expect(isHttpHostAllowed('93.184.216.34', ['93.184.216.34'])).toBe(false)
    expect(isHttpHostAllowed('10.0.0.1', ['*.example.com'])).toBe(false)
    expect(isHttpHostAllowed('127.0.0.1', [])).toBe(false)
    expect(isHttpHostAllowed('127.0.0.1', ['127.0.0.1'])).toBe(true)
    expect(isHttpHostAllowed('127.0.0.2', ['127.0.0.1'])).toBe(false)
    expect(isHttpHostAllowed('[::1]', ['[::1]'])).toBe(true)
    expect(isHttpHostAllowed('[::1]', [])).toBe(false)
  })

  it('ignores empty, overlong and bare-star entries, and needs a host', () => {
    expect(isHttpHostAllowed('', ['hooks.example.com'])).toBe(false)
    expect(isHttpHostAllowed('hooks.example.com', [])).toBe(false)
    expect(isHttpHostAllowed('hooks.example.com', ['', '*', `*.${'x'.repeat(300)}`])).toBe(false)
  })

  it('recognises loopback literals', () => {
    expect(isLoopbackLiteral('127.0.0.1')).toBe(true)
    expect(isLoopbackLiteral('127.0.0.2')).toBe(true)
    expect(isLoopbackLiteral('::1')).toBe(true)
    expect(isLoopbackLiteral('[::1]')).toBe(true)
    expect(isLoopbackLiteral('93.184.216.34')).toBe(false)
    expect(isLoopbackLiteral('hooks.example.com')).toBe(false)
  })
})

describe('http handler runs (M91 D70)', () => {
  it('refuses an oversized payload before sending it', async () => {
    const post = vi.fn<HookHttpPost>(() => Promise.resolve(hosted('{}')))
    const result = await runHttpHandler(
      { type: 'http', event: 'PreToolUse', source: 'user', httpUrl: 'https://hooks.example.com/h' },
      'x'.repeat(HOOK_STDIN_MAX_BYTES + 1),
      { httpPost: post },
      handlers(),
      new AbortController().signal,
      vi.fn(),
      (_e, _c, o) => parseAnswer(o),
    )
    expect(result.status).toBe('failed')
    expect(post).not.toHaveBeenCalled()
  })

  it('ends a wait on an HTTP runner that ignores cancellation', async () => {
    const controller = new AbortController()
    const started = vi.fn<HookHttpPost>(
      () =>
        new Promise(() => {
          /* Deliberately unresponsive runner. */
        }),
    )
    const work = dispatchHooks(
      [httpHook()],
      'PreToolUse',
      { cwd: '/ws' },
      'Read',
      {},
      controller.signal,
      vi.fn(),
      handlers({ httpPost: started }),
    )
    controller.abort()
    await expect(work).resolves.toMatchObject({ contexts: [] })
  })
  it('typed handlers cannot grant a PermissionRequest approval', async () => {
    const result = await dispatchHooks(
      [httpHook({ event: 'PermissionRequest' })],
      'PermissionRequest',
      { cwd: '/ws' },
      'Read',
      {},
      undefined,
      vi.fn(),
      handlers({ httpPost: () => Promise.resolve(hosted('{"decision":{"behavior":"allow"}}')) }),
    )
    expect(result.approvalDecision).toBeUndefined()
    expect(result.forceApproval).toBe(false)
  })
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/ws' })

  it('sends the bounded payload and parses the answer like a command', async () => {
    const post = vi.fn<HookHttpPost>(() =>
      Promise.resolve(hosted('{"decision":"block","reason":"no"}')),
    )
    const warn = vi.fn()
    const answer = await runSimpleHttp(post, warn)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]?.[0]).toBe('https://hooks.example.com/hook')
    expect(post.mock.calls[0]?.[1]).toBe(payload)
    expect(answer).toMatchObject({ status: 'blocked', reason: 'no' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('refuses off-list hosts, plain HTTP, project scope and a blocked network', async () => {
    const warn = vi.fn()
    const post = vi.fn<HookHttpPost>(() => Promise.resolve(hosted('{}')))
    const base = {
      type: 'http' as const,
      event: 'PreToolUse',
      source: 'user' as const,
      httpUrl: 'https://hooks.example.com/hook',
    }
    expect(
      await runHttpHandler(
        base,
        payload,
        { httpPost: post },
        handlers({ httpAllowlist: () => [] }),
        new AbortController().signal,
        warn,
        (_e, _c, o) => parseAnswer(o),
      ),
    ).toMatchObject({ status: 'failed' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not an allowed host'))
    expect(post).not.toHaveBeenCalled()

    const plain = await runHttpHandler(
      { ...base, httpUrl: plainHttpUrl() },
      payload,
      { httpPost: post },
      handlers(),
      new AbortController().signal,
      warn,
      (_e, _c, o) => parseAnswer(o),
    )
    expect(plain.status).toBe('failed')
    expect(warn).toHaveBeenCalledWith(UI_TEXT.hookHttpSchemeRefused)

    const project = await runHttpHandler(
      { ...base, source: 'project' },
      payload,
      { httpPost: post },
      handlers(),
      new AbortController().signal,
      warn,
      (_e, _c, o) => parseAnswer(o),
    )
    expect(project.status).toBe('failed')
    expect(warn).toHaveBeenCalledWith(UI_TEXT.hookHttpProjectRefused)

    const offline = await runHttpHandler(
      base,
      payload,
      { httpPost: post },
      handlers({ isNetworkAllowed: () => false }),
      new AbortController().signal,
      warn,
      (_e, _c, o) => parseAnswer(o),
    )
    expect(offline.status).toBe('failed')
    expect(warn).toHaveBeenCalledWith(UI_TEXT.hookHttpNetworkRefused)
    expect(post).not.toHaveBeenCalled()
  })

  it('refuses redirects without following them', async () => {
    const post = vi.fn(() =>
      Promise.resolve({
        status: 302,
        headers: { location: 'https://evil.example.com/x' },
        bodyText: '',
      }),
    )
    const warn = vi.fn()
    const answer = await runSimpleHttp(post, warn)
    expect(answer.status).toBe('failed')
    expect(post).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('redirected to evil.example.com'))
  })

  it('fails on errors and non-2xx answers, and rethrows on abort', async () => {
    const warn = vi.fn()
    const failing = { httpPost: () => Promise.reject(new Error('down')) }
    const answer = await runHttpHandler(
      {
        type: 'http',
        event: 'PreToolUse',
        source: 'user',
        httpUrl: 'https://hooks.example.com/hook',
      },
      payload,
      failing,
      handlers(),
      new AbortController().signal,
      warn,
      (_e, _c, o) => parseAnswer(o),
    )
    expect(answer.status).toBe('failed')

    const missing = await runHttpHandler(
      {
        type: 'http',
        event: 'PreToolUse',
        source: 'user',
        httpUrl: 'https://hooks.example.com/hook',
      },
      payload,
      { httpPost: () => Promise.resolve({ status: 500, headers: {}, bodyText: 'bad' }) },
      handlers(),
      new AbortController().signal,
      warn,
      (_e, _c, o) => parseAnswer(o),
    )
    expect(missing.status).toBe('failed')

    const controller = new AbortController()
    controller.abort()
    await expect(
      runHttpHandler(
        {
          type: 'http',
          event: 'PreToolUse',
          source: 'user',
          httpUrl: 'https://hooks.example.com/hook',
        },
        payload,
        { httpPost: () => Promise.reject(new Error('down')) },
        handlers(),
        controller.signal,
        warn,
        (_e, _c, o) => parseAnswer(o),
      ),
    ).rejects.toThrow('down')
  })

  it('sends fixed headers with no credential names', () => {
    expect(hookHttpHeaders()).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': expect.any(String),
    })
    expect(JSON.stringify(hookHttpHeaders())).not.toContain('API_KEY')
  })

  it('skips typed handlers without runners, through the dispatcher', async () => {
    const warn = vi.fn()
    const result = await dispatchHooks(
      [httpHook()],
      'PreToolUse',
      { cwd: '/ws' },
      'Bash',
      {},
      undefined,
      warn,
      undefined,
    )
    expect(result).toMatchObject({ blockedReason: undefined, contexts: [] })
    expect(warn).toHaveBeenCalledWith('PreToolUse: http hook runner is unavailable')
    expect(
      await runTypedHandler(
        { type: 'mcp_tool', event: 'PreToolUse', source: 'user' },
        '{}',
        handlers(),
        new AbortController().signal,
        warn,
        (_e, _c, o) => parseAnswer(o),
      ),
    ).toBeUndefined()
  })

  it('runs an http hook through the dispatcher and keeps its context', async () => {
    const warn = vi.fn()
    const result = await dispatchHooks(
      [httpHook()],
      'PreToolUse',
      { cwd: '/ws' },
      'Bash',
      {},
      undefined,
      warn,
      handlers({
        httpPost: () =>
          Promise.resolve(
            hosted(
              '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"from http"}}',
            ),
          ),
      }),
    )
    expect(warn).not.toHaveBeenCalled()
    expect(result.contexts).toHaveLength(1)
  })
})

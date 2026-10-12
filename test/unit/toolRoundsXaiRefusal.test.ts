import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { gitDraftContract } from '../../src/core/git/gitText'
import { mspApprovalMode } from '../../src/shared/permissionModes'
import {
  FAKE_MODEL_API_KEY,
  fakeModelApi,
  fakeModelApiClientSettings,
  type FakeModelApi,
} from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'

/**
 * The xAI refusal, sentence for sentence from
 * `docs/certification/toolrounds-captures/xai/1-wrap-up-tools-empty-choice-auto.json`:
 * 400 "A tool_choice was set on the request but no tools were specified."
 * Served in the error envelope the transport parses, so the provider's
 * reason reaches the caller verbatim; the raw capture's
 * `{code, error: string}` envelope is the provider-refusals lane's parse.
 */
const XAI_STATUS = 400
const XAI_MESSAGE =
  'Invalid request content: A tool_choice was set on the request but no tools were specified.'

/** A tool-less request that still carries a tool choice, the shape xAI refuses. */
function isRefusedShape(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const record = body as Record<string, unknown>
  if (!('tool_choice' in record)) return false
  const tools = record['tools']
  if (tools === undefined) return true
  if (!Array.isArray(tools)) return false
  if (tools.length === 0) return true
  // The ChatGPT profile's namespace wrapper with nothing declared.
  return tools.every(
    (tool) =>
      typeof tool === 'object' &&
      tool !== null &&
      (tool as Record<string, unknown>)['type'] === 'namespace' &&
      Array.isArray((tool as Record<string, unknown>)['tools']) &&
      ((tool as Record<string, unknown>)['tools'] as unknown[]).length === 0,
  )
}

/**
 * A fetch that answers the xAI way: 400 when `tool_choice` is present and
 * no tools are declared, the shared fake otherwise. Refused requests are
 * recorded like served ones, so a test sees the exact rejected bytes.
 */
function xaiRefusalFetch(api: FakeModelApi): typeof fetch {
  const inner = api.fetch
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = input instanceof Request ? input.method : (init?.method ?? 'GET')
    const headers = Object.fromEntries(
      Object.entries(
        (input instanceof Request ? input.headers : (init?.headers ?? {})) as Record<
          string,
          string
        >,
      ),
    )
    const bodyText =
      input instanceof Request ? undefined : typeof init?.body === 'string' ? init.body : undefined
    const body = bodyText === undefined ? undefined : (JSON.parse(bodyText) as unknown)
    if (body !== undefined && new URL(url).pathname.endsWith('/responses')) {
      const path = new URL(url).pathname.replace(/^\/v1/, '')
      api.requests.push({ path, method, headers, body })
      if (isRefusedShape(body)) {
        return Response.json(
          {
            error: {
              message: XAI_MESSAGE,
              type: 'invalid_request_error',
              code: 'invalid-argument',
            },
          },
          { status: XAI_STATUS, headers: { 'content-type': 'application/json' } },
        )
      }
      // Served tool-less requests must still be scripted; fall through to
      // the shared fake without recording twice.
      api.requests.pop()
    }
    return await inner(input, init)
  }
}

async function xaiHost() {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: xaiRefusalFetch(api),
  })
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
    remainingModelCalls: () => 2,
  })
  return { api, host, ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))) }
}

describe('tool-less side calls on a provider that refuses them (xAI)', () => {
  it('answers the xAI way: 400 for a choice without tools, 200 for the omitted shape', async () => {
    const api = fakeModelApi()
    const fetch = xaiRefusalFetch(api)
    const refused = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${FAKE_MODEL_API_KEY}` },
      body: JSON.stringify({ model: 'grok-4.3', tools: [], tool_choice: 'auto', input: [] }),
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({
      error: { message: expect.stringContaining('no tools were specified') },
    })
    api.script({ text: 'fine' })
    const served = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${FAKE_MODEL_API_KEY}` },
      body: JSON.stringify({ model: 'grok-4.3', input: [] }),
    })
    expect(served.status).toBe(200)
  })

  it('passes a refusal of a tooled request through in the providers words', async () => {
    const t = await xaiHost()
    try {
      // A refusal the omitted shape cannot prevent (tools declared) keeps
      // the provider's reason verbatim: no rewrite, no Internal error. The
      // refusal sentence itself belongs to the provider-refusals lane.
      t.api.script({
        httpError: {
          status: 400,
          body: { error: { message: XAI_MESSAGE, type: 'invalid_request_error' } },
        },
      })
      await t.session.sendTurn([{ type: 'text', text: 'Review within the limit' }])
      await t.turnDone()
      const completed = t.events.findLast((e) => e.type === 'turnCompleted')
      expect(completed).toMatchObject({ terminal: 'failed' })
      expect(JSON.stringify(completed)).toContain('no tools were specified')
      expect(JSON.stringify(t.events)).not.toContain('Internal error')
    } finally {
      await t.host.close()
    }
  })

  it('keeps the wrap-up summary instead of ending on the refusal', async () => {
    const t = await xaiHost()
    try {
      t.api.script(
        { calls: [{ name: 'get_goal', arguments: '{}', callId: 'tool-1' }] },
        { text: 'Done, found, remaining.' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review within the limit' }])
      await t.turnDone()
      // The wrap-up omits tools and tool choice alike, so the provider
      // answers 200: the summary is kept and the stop stays typed.
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Done, found, remaining.' }),
      )
      const last = t.api.responseBodies().at(-1)
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
      expect(JSON.stringify(t.events)).not.toContain('Internal error')
    } finally {
      await t.host.close()
    }
  })

  it('drafts a commit message through the refusal-shaped provider', async () => {
    const t = await xaiHost()
    try {
      const port = t.session.gitDraftOutput
      const attempt = gitDraftContract('commitMessage', port.formats())
      const signal = AbortSignal.timeout(10_000)
      port.prepare('commitMessage', attempt, signal)
      if (port.submit === undefined) throw new Error('expected the bound draft submission')
      t.api.script({ text: 'Add the parser' }, { text: 'Add the parser' })
      await port.submit([{ type: 'text', text: 'Write a commit message for the change' }])
      // The draft side call declares no tools, so the omitted shape answers
      // 200 and the provider's reason never has to surface.
      await expect(port.request('commitMessage', attempt, signal)).resolves.toBe('Add the parser')
      const last = t.api.responseBodies().at(-1)
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
    } finally {
      await t.host.close()
    }
  })

  it('compacts past the tool-less summary retry', async () => {
    const t = await xaiHost()
    try {
      t.api.script(
        { calls: [{ name: 'get_goal', arguments: '{}', callId: 'tool-1' }] },
        { text: 'Done.' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Seed some history' }])
      await t.turnDone()
      // The summary model answers with a tool call, so compaction retries
      // without reusing tools: that retry omits both fields and answers 200.
      t.api.script(
        { calls: [{ name: 'get_goal', arguments: '{}', callId: 'summary-tool' }] },
        { text: 'Earlier work is summarised.' },
      )
      await expect(t.session.compact()).resolves.toMatchObject({ status: 'accepted' })
      expect(JSON.stringify(t.api.responseBodies().at(-1))).not.toContain('"tool_choice"')
    } finally {
      await t.host.close()
    }
  })
})

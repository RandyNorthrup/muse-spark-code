import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../../src/core/backends/modelapi/client'
import type { CreateResponseBody } from '../../../src/core/backends/modelapi/schemas'
import { buildSessionExport } from '../../../src/core/export/sessionTransfer'
import {
  buildVaultProblemReportDraft,
  isSealedDraftCurrent,
} from '../../../src/core/support/problemReport'
import {
  exportConversation,
  type ConversationExports,
} from '../../../src/host/conversation/exportConversation'
import { VaultScrubService } from '../../../src/core/vault/scrub'
import { REDACTED_MARK } from '../../../src/shared/constants'
import { fakeModelApiClientSettings } from '../helpers/fakeModelApi'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { REPORT_FACTS } from '../helpers/reportFacts'

function body(text: string): CreateResponseBody {
  return {
    model: 'muse-spark-1.3',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }],
    instructions: text,
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'high' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: 100,
    prompt_cache_key: 'test',
    prompt_cache_retention: 'in_memory',
  }
}
async function vault() {
  const secret = `opaque:${randomBytes(24).toString('base64url')}:é`
  const service = new VaultScrubService()
  await service.unlock(() => Promise.resolve([Buffer.from(secret)]))
  return { secret, service }
}

describe('vault scrub boundaries', () => {
  it('scrubs the complete Model API body before every HTTP try, including token counting', async () => {
    const t = await vault(),
      sent: string[] = []
    const client = new ModelApiClient({
      ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
      vaultScrub: t.service,
      fetch: (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
        sent.push(init.body)
        return Promise.resolve(
          Response.json(sent.length === 1 ? { error: { message: 'retry' } } : { input_tokens: 1 }, {
            status: sent.length === 1 ? 500 : 200,
          }),
        )
      },
    })
    try {
      expect(await client.countInputTokens(body(t.secret))).toBe(1)
      expect(sent).toHaveLength(2)
      for (const text of sent) {
        expect(text).not.toContain(t.secret)
        expect(text).toContain(REDACTED_MARK)
        expect(() => {
          JSON.parse(text)
        }).not.toThrow()
      }
    } finally {
      t.service.lock()
    }
  })
  it('refuses sends on a scrub failure or malformed scrubbed JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    for (const scrub of [
      () => Promise.reject(new Error('unavailable')),
      () => Promise.resolve('not JSON'),
    ]) {
      const client = new ModelApiClient({
        ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
        fetch,
        vaultScrub: { scrub },
      })
      await expect(client.countInputTokens(body('text'))).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    }
  })
  it('checks Stop and attempt admission again after the asynchronous scrub', async () => {
    const pending = Promise.withResolvers<string>(),
      stop = new AbortController(),
      fetch = vi.fn<typeof globalThis.fetch>(),
      started = vi.fn()
    const client = new ModelApiClient({
      ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
      fetch,
      vaultScrub: { scrub: () => pending.promise },
    })
    const result = Array.fromAsync(
      client.streamResponse(
        body('text'),
        stop.signal,
        undefined,
        undefined,
        Object.assign(() => undefined, { onRequestStarted: started }),
      ),
    )
    stop.abort()
    pending.resolve(JSON.stringify(body('text')))
    await expect(result).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(started).not.toHaveBeenCalled()
  })
  it('removes vault values from portable JSON even when full export is selected', async () => {
    const t = await vault()
    try {
      const built = await buildSessionExport(
        {
          backend: 'modelApi',
          modelId: 'muse-spark-1.3',
          exportedAt: new Date(0).toISOString(),
          name: t.secret,
          items: [{ itemId: 'u', kind: 'userMessage', status: 'completed', text: t.secret }],
        },
        { redact: false, localRoots: [], vaultScrub: t.service },
      )
      expect(JSON.stringify(built.doc)).not.toContain(t.secret)
      expect(built.doc.name).toBe(REDACTED_MARK)
      expect(built.secrets).toBe(2)
    } finally {
      t.service.lock()
    }
  })
  it.each([
    ['json', 'full'],
    ['json', 'redacted'],
    ['markdown', 'full'],
  ] as const)(
    'scrubs %s/%s filenames, previews and saved bytes, and refuses failed scrubs',
    async (format, choice) => {
      const t = await vault(),
        late = `value${randomBytes(8).toString('hex')}`,
        saved: string[] = [],
        previews: string[] = []
      const exports: ConversationExports = {
        vaultScrub: t.service,
        saveMarkdown: (name, text) => {
          saved.push(name, text)
          return Promise.resolve()
        },
        saveJson: (name, text) => {
          saved.push(name, text)
          return Promise.resolve()
        },
        saveSessionLog: () => Promise.resolve(),
        localRoots: () => [],
        previewExport: async (preview) => {
          previews.push(preview.fileName, preview.content)
          await t.service.unlock(() => Promise.resolve([Buffer.from(t.secret), Buffer.from(late)]))
          return choice
        },
      }
      const host = {
          info: {
            kind: 'modelApi' as const,
            serverName: 'fake',
            serverVersion: '0',
            grantedCapabilities: [],
            canEditSessions: true,
          },
          readSession: () =>
            Promise.resolve({
              mode: 'inline' as const,
              name: late,
              items: [
                {
                  itemId: 'u',
                  kind: 'userMessage',
                  status: 'completed',
                  text: `${t.secret} ${late}`,
                },
              ],
              todos: [],
            }),
        },
        session = { sessionId: 'session', modelId: 'muse-spark-1.3' }
      try {
        expect(await exportConversation(host, session, format, new Date(0), exports)).toBe(
          'exported',
        )
        expect(JSON.stringify([...saved, ...previews])).not.toContain(t.secret)
        if (format === 'json') expect(JSON.stringify(saved)).not.toContain(late)
        saved.length = 0
        t.service.lock()
        await expect(
          exportConversation(host, session, format, new Date(0), exports),
        ).rejects.toThrow()
        expect(saved).toEqual([])
      } finally {
        t.service.lock()
      }
    },
  )
  it('refuses the opaque CLI session-log writer when vault scrubbing is required', async () => {
    const writer = vi.fn(() => Promise.resolve())
    const result = exportConversation(
      {
        info: {
          kind: 'museCode',
          serverName: 'fake',
          serverVersion: '0',
          grantedCapabilities: [],
          canEditSessions: true,
        },
        readSession: vi.fn(),
      },
      { sessionId: 's', modelId: 'm' },
      'sessionLog',
      new Date(0),
      {
        vaultScrub: { scrub: (text) => Promise.resolve(text) },
        saveSessionLog: writer,
        saveMarkdown: writer,
        saveJson: writer,
        previewExport: () => Promise.resolve('dismissed'),
        localRoots: () => [],
      },
    )
    await expect(result).rejects.toThrow('session log export is unavailable')
    expect(writer).not.toHaveBeenCalled()
  })
  it('scrubs the final report before sealing, including the percent/base64 forms', async () => {
    const t = await vault()
    const input = {
      description: `${t.secret} ${encodeURIComponent(t.secret)} ${Buffer.from(t.secret).toString('base64')}`,
      includeFacts: true,
      includeEvents: false,
      facts: REPORT_FACTS,
      events: [],
      recordingUnavailable: false,
      nowMs: 0,
      scrub: { workspaceRoots: [], homeDir: '', extraLiterals: [] },
    }
    try {
      const draft = await buildVaultProblemReportDraft(input, t.service)
      expect(draft.text).not.toContain(t.secret)
      expect(draft.text).not.toContain(Buffer.from(t.secret).toString('base64'))
      expect(isSealedDraftCurrent(draft)).toBe(true)
      t.service.lock()
      await expect(buildVaultProblemReportDraft(input, t.service)).rejects.toThrow()
    } finally {
      t.service.lock()
    }
  })
  it('withholds deselected sections from the vault report before sealing', async () => {
    const t = await vault()
    const input = {
      description: 'plain description',
      includeFacts: false,
      includeEvents: false,
      facts: REPORT_FACTS,
      events: [
        { kind: 'toolCallFailed', code: 'timeout', frames: [], ageMs: 1000 },
        { notAnEvent: true },
      ],
      recordingUnavailable: false,
      nowMs: 0,
      scrub: { workspaceRoots: [], homeDir: '', extraLiterals: [] },
    }
    try {
      const draft = await buildVaultProblemReportDraft(input, t.service)
      expect(draft.text).not.toContain('Support facts:')
      expect(draft.text).not.toContain('Recent events:')
      expect(draft.text).toContain('plain description')
      expect(isSealedDraftCurrent(draft)).toBe(true)
    } finally {
      t.service.lock()
    }
  })
})

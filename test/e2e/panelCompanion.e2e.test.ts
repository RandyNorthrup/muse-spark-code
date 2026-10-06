import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { panelProcessSuite } from './panelProcess'

const fixture = panelProcessSuite()
const launchSchema = z.object({
  id: z.string(),
  method: z.literal('ui/openExternal'),
  params: z.object({ uri: z.string() }),
})

describe('runtime companion panel process', () => {
  for (const backend of ['museCode', 'modelApi'])
    it(`authenticates one window and streams fake ${backend} through MHP HTTP/SSE`, async () => {
      const agent = fixture().launch('companion', backend)
      await agent.initialize()
      const frame = launchSchema.parse(
        await agent.wait((value) => launchSchema.safeParse(value).success),
      )
      agent.send({ jsonrpc: '2.0', id: frame.id, result: null })
      const url = new URL(frame.params.uri)
      const code = new URLSearchParams(url.hash.slice(1)).get('k')
      const origin = url.origin
      const headers = {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Muse-Panel': '1',
        'Sec-Fetch-Site': 'same-origin',
      }
      const session = await fetch(`${origin}/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code }),
      })
      expect(session.status).toBe(200)
      const bearer = session.headers.get('authorization')
      if (bearer === null) throw new Error('Fake window missing bearer')
      const page = await fetch(origin, { headers: { ...headers, Authorization: bearer } })
      const html = await page.text()
      const sessionId = /data-session-id="([^"]+)"/u.exec(html)?.[1]
      if (sessionId === undefined) throw new Error('Fake page missing session binding')
      const authenticated = { ...headers, Authorization: bearer }
      const controller = new AbortController()
      const stream = await fetch(`${origin}/panel/events`, {
        headers: authenticated,
        signal: controller.signal,
      })
      expect(stream.status).toBe(200)
      let events = ''
      const reading = (async () => {
        try {
          if (stream.body === null) throw new Error('No SSE')
          for await (const chunk of stream.body) events += new TextDecoder().decode(chunk)
        } catch (error: unknown) {
          if (!controller.signal.aborted) throw error
        }
      })()
      const binding = {
        mhp: '1.1',
        kind: 'surface',
        surface: 'browser-view',
        sessionId,
        surfaceKind: 'chat',
      }
      const post = (path: string, body: unknown) =>
        fetch(`${origin}${path}`, {
          method: 'POST',
          headers: authenticated,
          body: JSON.stringify(body),
        })
      const opened = await post('/panel/surface', { ...binding, event: 'opened' })
      expect(opened.status).toBe(204)
      const ready = await post('/panel/surface', { ...binding, event: 'ready' })
      expect(ready.status).toBe(204)
      const message = {
        mhp: '1.1',
        kind: 'panel',
        surface: 'browser-view',
        direction: 'toHost',
        seq: 1,
        payload: { type: 'ready' },
      }
      const admitted = await post('/panel/message', message)
      expect(admitted.status).toBe(204)
      const submitted = await post('/panel/message', {
        ...message,
        seq: 2,
        payload: { type: 'sendMessage', localId: 'local', text: 'hello', attachmentIds: [] },
      })
      expect(submitted.status).toBe(204)
      await vi.waitFor(
        () => {
          expect(events).toContain(
            backend === 'museCode' ? 'echo: hello' : 'From the fake panel model.',
          )
        },
        { timeout: 10_000 },
      )
      expect(events).toContain('event: mhp\nid: browser-view:toPanel:')
      expect(events).not.toContain('LLM|')
      const replay = await post('/panel/message', { ...message, seq: 2 })
      expect(replay.status).toBe(409)
      const replayError: unknown = await replay.json()
      expect(replayError).toMatchObject({ code: 'MHP_PANEL_OUT_OF_ORDER' })
      controller.abort()
      await reading
      agent.child.stdin.end()
      expect(await agent.exited).toBe(0)
    })
  it('fails initialization and exits after the fake CLI dies', async () => {
    const agent = fixture().launch('companion', 'museCode', { MUSE_FAKE_START: 'crash' })
    agent.sendInitialize()
    await agent.wait(
      (value) =>
        z
          .object({ error: z.object({ message: z.literal('MHP_INITIALIZE_FAILED') }) })
          .safeParse(value).success,
    )
    agent.child.stdin.end()
    expect(await agent.exited).toBe(0)
  })
})

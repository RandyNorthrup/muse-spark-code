import { startBrowserFixture } from '../unit/helpers/companion'
import * as z from 'zod/mini'
import { panelBindingSchema } from '../../src/shared/hostApi/panel'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { panelProcessSuite } from './panelProcess'

const fixture = panelProcessSuite()
// Chrome startup belongs to the suite; each backend gets its own default-deadline test.
const browser: { current?: Awaited<ReturnType<typeof startBrowserFixture>> } = {}
beforeAll(async () => {
  browser.current = await startBrowserFixture()
})
afterAll(async () => {
  await browser.current?.close()
})
const launchSchema = z.object({
  id: z.string(),
  method: z.literal('ui/openExternal'),
  params: z.object({ uri: z.string() }),
})

async function acknowledgeLaunch(agent: ReturnType<ReturnType<typeof fixture>['launch']>) {
  await agent.initialize()
  const frame = launchSchema.parse(
    await agent.wait((value) => launchSchema.safeParse(value).success),
  )
  agent.send({ jsonrpc: '2.0', id: frame.id, result: null })
  return frame.params.uri
}

describe('runtime companion panel process', () => {
  for (const backend of ['museCode', 'modelApi'])
    it(`authenticates one window and streams fake ${backend} through MHP HTTP/SSE`, async () => {
      const agent = fixture().launch('companion', backend)
      const url = new URL(await acknowledgeLaunch(agent))
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
      const bindingText =
        /<script type="application\/json" id="muse-panel">([^<]+)<\/script>/u.exec(html)?.[1]
      if (bindingText === undefined) throw new Error('Fake page missing surface binding')
      const { surface } = panelBindingSchema.parse(JSON.parse(bindingText))
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
        mhp: '1.5',
        kind: 'surface',
        surface,
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
        mhp: '1.5',
        kind: 'panel',
        surface,
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
      expect(events).toContain(`event: mhp\nid: ${surface}:toPanel:`)
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
  for (const backend of ['museCode', 'modelApi'])
    it(`mounts the authenticated shared React graph and streams fake ${backend} in Chrome`, async () => {
      const runningBrowser = browser.current?.browser
      if (runningBrowser === undefined)
        throw new Error('Shared fake browser fixture was not prepared')
      const agent = fixture().launch(
        'companion',
        backend,
        {},
        backend === 'modelApi' ? ['--web-search'] : [],
      )
      const uri = await acknowledgeLaunch(agent)
      const context = await runningBrowser.newContext()
      try {
        const page = await context.newPage()
        const errors: string[] = []
        const requests: string[] = []
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        page.on('request', (request) => {
          requests.push(request.url())
        })
        await page.goto(uri)
        await page.waitForFunction(
          () => typeof Reflect.get(window, 'musePanel')?.postMessage === 'function',
        )
        try {
          await page.waitForFunction(() => document.querySelector('textarea') !== null)
        } catch (error: unknown) {
          throw new Error(
            `Browser did not mount: ${JSON.stringify(errors)}; ${await page.locator('body').innerText()}`,
            { cause: error },
          )
        }
        const before = fixture().api.responseBodies().length
        await page.evaluate(() => {
          const panel = globalThis.window.musePanel
          if (panel === undefined) throw new Error('Missing fake panel bridge')
          panel.postMessage({
            type: 'sendMessage',
            localId: 'browser',
            text: 'hello browser',
            attachmentIds: [],
          })
        })
        await page
          .getByText(
            backend === 'museCode' ? 'echo: hello browser' : 'From the fake panel model.',
            { exact: false },
          )
          .first()
          .waitFor()
        if (backend === 'modelApi') {
          expect(await page.getByRole('dialog').count()).toBe(0)
          expect(fixture().api.responseBodies()).toHaveLength(before + 1)
          expect(JSON.stringify(fixture().api.responseBodies().at(-1)?.['tools'])).not.toContain(
            'web_search',
          )
        }
        expect(errors).toEqual([])
        expect(requests.some((url) => url.includes('/assets/portable/chunks/'))).toBe(true)
        expect(requests.some((url) => url.includes('#k='))).toBe(false)
        expect(new URL(page.url()).hash).toBe('')
        expect(await context.cookies()).toEqual([])
        const noBearer = await fetch(new URL('/assets/portable/main.js', uri))
        expect(noBearer.status).toBe(401)
        expect(agent.output().stdout).not.toContain('LLM|')
      } finally {
        await context.close()
      }
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

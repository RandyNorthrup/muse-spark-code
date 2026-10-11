import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { REVIEW_BROWSER_KEY } from './helpers/reviewBrowser.mjs'

const runtime = { listeners: new Set() }
afterEach(() => {
  for (const listener of runtime.listeners) listener.close()
  runtime.listeners.clear()
})
beforeAll(async () => {
  runtime.root = await mkdtemp(path.join(tmpdir(), 'cm952-chrome-'))
  const outfile = path.join(runtime.root, 'flow.mjs')
  await build({
    stdin: {
      contents: `export * from './src/host/providers/openRouter';
      export * from './src/host/providers/oauthLoopback';
      export * from './src/core/providers/pkce';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
  })
  runtime.core = await import(pathToFileURL(outfile).href)
  runtime.browser = await chromium.connect(inject(REVIEW_BROWSER_KEY))
})
afterAll(async () => {
  await runtime.browser?.close()
  if (runtime.root !== undefined) await rm(runtime.root, { recursive: true, force: true })
})

describe('OpenRouter PKCE in real Chrome, with a fake authorization page', () => {
  it('returns the authorized key once without pasting and shuts down the callback listener', async () => {
    const page = await runtime.browser.newPage()
    let redirectUri
    const exchange = vi.fn(() => Promise.resolve('sk-or-synthetic-browser-test-key'))
    try {
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin === 'https://openrouter.ai' && url.pathname === '/auth') {
          redirectUri = url.searchParams.get('callback_url')
          const callback = new URL(redirectUri)
          callback.searchParams.set('code', 'synthetic-browser-code')
          callback.searchParams.set('state', url.searchParams.get('state'))
          await route.fulfill({
            contentType: 'text/html',
            body: `<a href="${callback.href.replaceAll('&', '&amp;')}">Authorize</a>`,
          })
        } else if (url.hostname === '127.0.0.1') await route.continue()
        else await route.abort()
      })
      const connected = await runtime.core.connectOpenRouterAccount({
        pkce: {
          create: runtime.core.createPkcePair,
          newState: () => runtime.core.createPkcePair().state,
        },
        exchange: { exchange },
        startServer: runtime.core.startOAuthLoopback,
        openBrowser: async (url) => {
          await page.goto(url)
          await page.getByRole('link', { name: 'Authorize' }).click()
        },
        isRemote: false,
        promptForPastedCode: () => {
          throw new Error('Local Connect must never ask for a pasted code')
        },
      })
      expect(connected.key).toBe('sk-or-synthetic-browser-test-key')
      expect(connected.record.origin).toBe('https://openrouter.ai')
      expect(connected.record.auth).toBe('apiKey')
      expect(exchange).toHaveBeenCalledTimes(1)
      expect(exchange.mock.calls[0][0]).toMatchObject({
        code: 'synthetic-browser-code',
        redirectUri,
      })
      await expect(fetch(redirectUri)).rejects.toThrow()
    } finally {
      await page.close()
    }
  })
  it('closes the listener when opening the browser fails', async () => {
    let loopback
    const exchange = vi.fn()
    await expect(
      runtime.core.connectOpenRouterAccount({
        pkce: {
          create: runtime.core.createPkcePair,
          newState: () => runtime.core.createPkcePair().state,
        },
        exchange: { exchange },
        startServer: async (state) => {
          loopback = await runtime.core.startOAuthLoopback(state)
          runtime.listeners.add(loopback)
          return loopback
        },
        openBrowser: () => Promise.reject(new Error('synthetic-browser-failure')),
        isRemote: false,
        promptForPastedCode: vi.fn(),
      }),
    ).rejects.toThrow('synthetic-browser-failure')
    expect(exchange).not.toHaveBeenCalled()
    await expect(fetch(loopback.redirectUri)).rejects.toThrow()
  })
  it('closes a pending listener on panel cancellation without exchanging the code', async () => {
    let loopback
    const controller = new globalThis.AbortController()
    const exchange = vi.fn()
    await expect(
      runtime.core.connectOpenRouterAccount({
        pkce: {
          create: runtime.core.createPkcePair,
          newState: () => runtime.core.createPkcePair().state,
        },
        exchange: { exchange },
        startServer: async (state) => {
          loopback = await runtime.core.startOAuthLoopback(state)
          runtime.listeners.add(loopback)
          return loopback
        },
        openBrowser: () => {
          controller.abort()
          return Promise.resolve()
        },
        isRemote: false,
        promptForPastedCode: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    expect(exchange).not.toHaveBeenCalled()
    await expect(fetch(loopback.redirectUri)).rejects.toThrow()
  })
})

import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { chromium } from 'playwright-core'
import * as acp from '@agentclientprotocol/sdk'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { openVoiceCompanion } from '../../src/runtime/companion/voiceEntry.ts'
import { createAcpAgent } from '../../src/acp/agent.ts'
import { AcpPaidUse } from '../../src/acp/paid.ts'
import { FakeAgentHost, museCodeTestBackend } from './helpers/fakeAgent.ts'
import { memoryPaidGrants } from './helpers/paidGrants.ts'
import { paidGrantFile } from '../../src/runtime/paidGrants.ts'
import { EN } from '../../src/shared/l10n/en.ts'
import { companionWav, companionWavSeconds } from '../../src/shared/companionWav.ts'
import {
  ACP_PAID_GRANTS_FILE,
  ACP_SESSIONS_SUBFOLDER,
  COMPANION_VOICE_BODY_BYTES,
  MUSE_VOICE_SAMPLE_RATE,
} from '../../src/shared/constants.ts'
import { call, headers, login } from './helpers/companion.ts'

// One compile/browser warmup for the file; each test retains the repo deadline.
const root = await mkdtemp(path.join(tmpdir(), 'voice-browser-'))
const reviewRoot = path.resolve('temp', 'voice-review')
await mkdir(reviewRoot, { recursive: true })
await mkdir(path.join(root, 'dist', 'webview'), { recursive: true })
await build({
  entryPoints: ['src/webview/voice/companion.ts'],
  outfile: path.join(root, 'dist', 'webview', 'voiceCompanion.js'),
  bundle: true,
  minify: true,
  plugins: [compactBrowserUiText],
  platform: 'browser',
  format: 'esm',
  logLevel: 'silent',
})
const pcm = new Int16Array(MUSE_VOICE_SAMPLE_RATE * 3)
for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 10) * 1000)
const sound = path.join(root, 'fake-mic.wav')
await writeFile(sound, companionWav(pcm))
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${sound}`,
  ],
})
const warm = await browser.newPage()
await warm.goto('about:blank')
await warm.close()
const servers = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await Promise.all(browser.contexts().map((context) => context.close()))
})
afterAll(async () => {
  await browser.close()
  await rm(root, { recursive: true, force: true })
})

async function pageFor(send = vi.fn(() => Promise.resolve()), isVoiceOn = true, owner, dataFolder) {
  const recording = vi.fn()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const controller = new globalThis.AbortController()
  const panel = await openVoiceCompanion(
    {
      packageRoot: root,
      dataFolder: dataFolder ?? (await mkdtemp(path.join(root, 'data-'))),
      temporaryRoot: root,
      platform: 'linux',
      systemRoot: undefined,
      programFiles: undefined,
      isVoiceOn: () => isVoiceOn,
      canRemember: () => false,
      getKey: () => Promise.resolve('synthetic-companion-credential'),
      log,
      sleep: () => Promise.resolve(),
      fetch: async (url, init) => {
        const form = init?.body
        if (!(form instanceof globalThis.FormData)) throw new Error('form absent')
        const file = form.get('audio')
        if (!(file instanceof globalThis.Blob)) throw new Error('WAV absent')
        const bytes = new Uint8Array(await file.arrayBuffer())
        const seconds = companionWavSeconds(bytes)
        recording({ bytes, seconds })
        return globalThis.Response.json({
          sessionId: new URL(url).searchParams.get('sessionId'),
          transcript: 'The blue llama counts to seven.',
          audioDurationMs: Math.floor(seconds * 1000),
          turns: [],
        })
      },
    },
    owner ?? {
      cwd: '/workspace',
      isCurrent: () => !controller.signal.aborted,
      signal: controller.signal,
      send,
    },
    EN,
    'en',
  )
  servers.push(panel)
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  await page.addInitScript(() => {
    const real = globalThis.navigator.mediaDevices.getUserMedia.bind(
      globalThis.navigator.mediaDevices,
    )
    Object.defineProperty(globalThis, 'voiceProbe', { value: { calls: 0, tracks: [] } })
    globalThis.navigator.mediaDevices.getUserMedia = async (options) => {
      globalThis.voiceProbe.calls += 1
      const stream = await real(options)
      globalThis.voiceProbe.tracks.push(...stream.getTracks())
      return stream
    }
  })
  await page.goto(panel.launchUrl(), { waitUntil: 'commit' })
  await page.locator('html[data-launch="ready"]').waitFor()
  return { page, panel, recording, send, errors }
}

async function capture(page, consent) {
  await page.getByRole('button', { name: 'Dictate', exact: true }).click()
  if (consent) {
    await page.getByRole('dialog').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Allow once', exact: true }).click()
  }
  await page.waitForFunction(
    () => globalThis.document.querySelector('#status')?.textContent === 'Listening…',
  )
  expect(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled()).toBe(true)
  // A real encoder needs one audio frame; no enlarged test timeout.
  await page.waitForTimeout(350)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.waitForFunction(() =>
    globalThis.document.querySelector('#prompt')?.value.includes('blue llama'),
  )
}

describe('authenticated voice companion in real Chrome', () => {
  it('refuses a Linux free-only launch with an honest engine error', async () => {
    const dataFolder = await mkdtemp(path.join(root, 'revocation-'))
    const log = { warn: vi.fn(), trace: vi.fn(), info: vi.fn(), error: vi.fn() }
    const grants = paidGrantFile({
      file: path.join(dataFolder, ACP_SESSIONS_SUBFOLDER, ACP_PAID_GRANTS_FILE),
      log,
      sleep: () => Promise.resolve(),
    })
    await grants.add('/workspace', ['voice'])
    await expect(pageFor(undefined, false, undefined, dataFolder)).rejects.toThrow(
      EN.dictationUnavailableLinux,
    )
    expect(grants.read('/workspace')).toEqual(new Set())
  })
  it('captures real fake-device audio after consent, asks once, reviews at the caret and sends explicitly', async () => {
    const h = await pageFor()
    await h.page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await h.page.getByRole('dialog').waitFor({ state: 'visible' })
    expect(await h.page.evaluate(() => globalThis.voiceProbe.calls)).toBe(0)
    expect(await h.page.locator('#consent-detail').textContent()).toContain('$0.18')
    expect(h.recording).not.toHaveBeenCalled()
    await h.page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await h.page.waitForFunction(
      () => globalThis.document.querySelector('#status')?.textContent === 'Listening…',
    )
    await h.page.waitForTimeout(350)
    await h.page.getByRole('button', { name: 'Stop', exact: true }).click()
    await h.page.waitForFunction(() =>
      globalThis.document.querySelector('#prompt')?.value.includes('blue llama'),
    )
    expect(h.recording).toHaveBeenCalledTimes(1)
    expect(h.send).not.toHaveBeenCalled()
    expect(
      await h.page.evaluate(() =>
        globalThis.voiceProbe.tracks.every((track) => track.readyState === 'ended'),
      ),
    ).toBe(true)
    await h.page.locator('#prompt').fill('Prefix: ')
    await capture(h.page, false)
    expect(await h.page.getByRole('dialog').isVisible()).toBe(false)
    expect(await h.page.locator('#prompt').inputValue()).toBe(
      'Prefix: The blue llama counts to seven.',
    )
    await h.page.getByRole('button', { name: 'Send', exact: true }).click()
    await h.page.waitForFunction(() => globalThis.document.querySelector('#prompt')?.value === '')
    expect(h.send).toHaveBeenCalledExactlyOnceWith(
      'Prefix: The blue llama counts to seven.',
      expect.any(globalThis.AbortSignal),
    )
    expect(h.errors).toEqual([])
    expect(
      await h.page.evaluate(() => [
        globalThis.localStorage.length,
        globalThis.sessionStorage.length,
      ]),
    ).toEqual([0, 0])
  })
  it('denies consent without opening the microphone or charging', async () => {
    const h = await pageFor()
    await h.page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await h.page.getByRole('dialog').waitFor({ state: 'visible' })
    await h.page.getByRole('dialog').getByRole('button', { name: 'Deny', exact: true }).click()
    await h.page.waitForFunction(() =>
      globalThis.document.querySelector('#status')?.textContent.startsWith('Dictation failed'),
    )
    expect(await h.page.evaluate(() => globalThis.voiceProbe.calls)).toBe(0)
    expect(h.recording).not.toHaveBeenCalled()
  })
  it('closes the companion and cancels pending consent when its runtime lifetime ends', async () => {
    const lifetime = new globalThis.AbortController()
    const session = new globalThis.AbortController()
    const send = vi.fn(() => Promise.resolve())
    const h = await pageFor(send, true, {
      cwd: '/workspace',
      signal: globalThis.AbortSignal.any([session.signal, lifetime.signal]),
      isCurrent: () => !session.signal.aborted && !lifetime.signal.aborted,
      send,
    })
    await h.page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await h.page.getByRole('dialog').waitFor({ state: 'visible' })
    lifetime.abort()
    await h.panel.closed
    expect(await h.page.evaluate(() => globalThis.voiceProbe.calls)).toBe(0)
    expect(h.recording).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
  it('cancels a pending microphone permission and stops a late stream', async () => {
    const h = await pageFor()
    await h.page.evaluate(() => {
      const real = globalThis.navigator.mediaDevices.getUserMedia.bind(
        globalThis.navigator.mediaDevices,
      )
      globalThis.navigator.mediaDevices.getUserMedia = (options) =>
        new Promise((resolve, reject) => {
          globalThis.voiceProbe.release = async () => {
            try {
              resolve(await real(options))
            } catch (error) {
              reject(error)
            }
          }
        })
    })
    await h.page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await h.page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await h.page.waitForFunction(() => typeof globalThis.voiceProbe.release === 'function')
    await h.page.locator('#cancel').click()
    await h.page.evaluate(() => {
      globalThis.voiceProbe.release()
    })
    await h.page.waitForFunction(
      () =>
        globalThis.voiceProbe.tracks.length > 0 &&
        globalThis.voiceProbe.tracks.every((track) => track.readyState === 'ended'),
    )
    expect(h.recording).not.toHaveBeenCalled()
    expect(h.errors).toEqual([])
  })
  it('refuses foreign origin, missing bearer and oversized request before an engine runs', async () => {
    const h = await pageFor()
    const token = await login(h.panel)
    const good = headers(h.panel, token)
    const foreign = [...good]
    foreign[foreign.indexOf('Origin') + 1] = 'https://hostile.invalid'
    expect(await call(h.panel, '/post', 'POST', '{}', foreign)).toHaveProperty('status', 403)
    expect(await call(h.panel, '/post', 'POST', '{}', headers(h.panel))).toHaveProperty(
      'status',
      401,
    )
    const valid = JSON.stringify({
      type: 'begin',
      id: globalThis.crypto.randomUUID(),
      engine: 'system',
    })
    const padded = valid.padEnd(COMPANION_VOICE_BODY_BYTES + 1)
    expect(await call(h.panel, '/post', 'POST', padded, good)).toHaveProperty('status', 400)
    expect(h.recording).not.toHaveBeenCalled()
  })
  it('stays accessible and within 320px in every token theme, including the paid dialog', async () => {
    const h = await pageFor()
    const axe = await readFile(
      createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
      'utf8',
    )
    await h.page.evaluate(axe)
    for (const theme of ['dark', 'light', 'hc-dark', 'hc-light']) {
      await h.page.evaluate((mode) => {
        globalThis.document.documentElement.dataset.msTheme = mode
      }, theme)
      const result = await h.page.evaluate(() => globalThis.axe.run())
      expect(result.violations).toEqual([])
      expect(
        await h.page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
      ).toBe(true)
      await h.page.screenshot({ path: path.join(reviewRoot, `voice-${theme}-320.png`) })
    }
    await h.page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await h.page.getByRole('dialog').waitFor({ state: 'visible' })
    const dialogResult = await h.page.evaluate(() => globalThis.axe.run())
    expect(dialogResult.violations).toEqual([])
    await h.page.screenshot({ path: path.join(reviewRoot, 'voice-dialog-hc-light-320.png') })
  })
  it('keeps the review and consent dialog within the desktop viewport', async () => {
    const h = await pageFor()
    await h.page.setViewportSize({ width: 960, height: 760 })
    await h.page.getByRole('button', { name: 'Dictate', exact: true }).click()
    await h.page.getByRole('dialog').waitFor({ state: 'visible' })
    expect(
      await h.page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true)
    await h.page.screenshot({ path: path.join(reviewRoot, 'voice-dialog-dark-960.png') })
  })
  it.each(['once', 'deny', 'closed'])(
    'ACP editor permission %s keeps microphone and prompt ownership honest',
    async (decision) => {
      const host = new FakeAgentHost()
      const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      let context
      let h
      const app = createAcpAgent({
        backend: museCodeTestBackend(host),
        version: 'test',
        questions: 'decline',
        defaultCwd: '/workspace',
        options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
        signIn: { id: 'test', name: 'test', description: 'test', args: [], command: 'test' },
        paid: new AcpPaidUse({
          flagged: [],
          canRemember: () => false,
          grants: memoryPaidGrants(),
          log,
        }),
        log,
        dictation: async (owner) => {
          context = owner
          h = await pageFor(owner.send, true, owner)
          return h.panel
        },
      })
      const permissions = []
      let ownerClient
      await acp
        .client({ name: 'voice-browser-test' })
        .onRequest('session/request_permission', async (request) => {
          permissions.push(request.params)
          expect(await h.page.evaluate(() => globalThis.voiceProbe.calls)).toBe(0)
          if (decision === 'closed')
            await ownerClient.request('session/close', { sessionId: request.params.sessionId })
          else if (decision === 'deny') return { outcome: { outcome: 'cancelled' } }
          const once = request.params.options.find((option) => option.kind === 'allow_once')
          if (once === undefined) throw new Error('paid option missing')
          return { outcome: { outcome: 'selected', optionId: once.optionId } }
        })
        .connectWith(app, async (client) => {
          ownerClient = client
          await client.request('initialize', {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {},
          })
          const { sessionId } = await client.request('session/new', {
            cwd: '/workspace',
            mcpServers: [],
          })
          await client.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: '/dictate' }],
          })
          expect(host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
          if (decision !== 'once') {
            await h.page.getByRole('button', { name: 'Dictate', exact: true }).click()
            if (decision === 'closed') await h.panel.closed
            else
              await h.page.waitForFunction(() =>
                globalThis.document
                  .querySelector('#status')
                  ?.textContent.startsWith('Dictation failed'),
              )
            expect(await h.page.evaluate(() => globalThis.voiceProbe.calls)).toBe(0)
            expect(h.recording).not.toHaveBeenCalled()
            expect(host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
            if (decision !== 'closed') await client.request('session/close', { sessionId })
            return
          }
          await capture(h.page, false)
          await h.page.getByRole('button', { name: 'Send', exact: true }).click()
          await vi.waitFor(() => {
            expect(host.sessions[0]?.sendTurn).toHaveBeenCalledTimes(1)
          })
          expect(host.sessions[0]?.sendTurn).toHaveBeenCalledWith(
            [{ type: 'text', text: 'The blue llama counts to seven.' }],
            'The blue llama counts to seven.',
          )
          expect(permissions).toHaveLength(1)
          expect(permissions[0].toolCall.content[0].content.text).toContain('$0.18')
          expect(context.isCurrent()).toBe(true)
          await client.request('session/close', { sessionId })
        })
      expect(context.isCurrent()).toBe(false)
      expect(context.signal.aborted).toBe(true)
    },
  )
})

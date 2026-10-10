import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinuxDictation } from '../../src/core/voice/linuxDictation'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeChild } from './helpers/dictationChild'
import { SILENT_LOG } from './helpers/captureListener'

const state = { directory: '' }
const bytes = Buffer.from('model')
const pin = {
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  url: 'https://models.example/model.bin',
}
const drivers: LinuxDictation[] = []
beforeEach(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'm9-driver-'))
})
afterEach(async () => {
  await Promise.all(
    drivers.splice(0).map(async (driver) => {
      driver.dispose()
      await driver.reset()
    }),
  )
  await rm(state.directory, { recursive: true, force: true })
})
function setup(
  canDownload: (signal: AbortSignal) => Promise<boolean> = () => Promise.resolve(true),
) {
  const child = new FakeChild()
  const listener = { onStatus: vi.fn(), onText: vi.fn(), onError: vi.fn(), onStopped: vi.fn() }
  const spawn = vi.fn(() => child)
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(bytes)))
  const isEnabled = vi.fn(() => true)
  const driver = new LinuxDictation({
    invocation: { command: 'bundled-helper', args: [] },
    spawn,
    listener,
    log: SILENT_LOG,
    isEnabled,
    model: { directory: state.directory, pin, fetch: fetcher, consent: canDownload },
  })
  drivers.push(driver)
  return { driver, listener, spawn, fetcher, isEnabled, child }
}

async function ready(test: ReturnType<typeof setup>) {
  test.driver.start()
  await vi.waitFor(() => {
    expect(test.spawn).toHaveBeenCalledTimes(1)
  })
  test.child.emitLine({ type: 'ready', language: 'en' })
  test.child.emitLine({ type: 'listening' })
}
async function preparing() {
  const answer = Promise.withResolvers<boolean>()
  const entered = vi.fn()
  const test = setup(() => {
    entered()
    return answer.promise
  })
  test.driver.start()
  await vi.waitFor(() => {
    expect(entered).toHaveBeenCalled()
  })
  return { ...test, answer }
}

describe('Linux dictation preparation and helper protocol', () => {
  it('starts only after acquisition and inserts trimmed phrases before the stopped acknowledgement', async () => {
    const test = setup()
    test.driver.start()
    expect(test.spawn).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(test.spawn).toHaveBeenCalledTimes(1)
    })
    test.child.emitLine({ type: 'ready', language: 'en' })
    expect(test.child.sent).toEqual(['start'])
    test.child.emitLine({ type: 'listening' })
    test.driver.stop()
    test.child.emitLine({ type: 'text', text: ' final words ' })
    test.child.emitLine({ type: 'stopped' })
    expect(test.listener.onText).toHaveBeenCalledWith('final words')
    expect(test.listener.onStopped).toHaveBeenCalledTimes(1)
    expect(test.child.sent).toEqual(['start', 'stop'])
  })
  it('refusal produces idle with no process or request and retries on the next press', async () => {
    const consent = vi.fn(() => Promise.resolve(false))
    const test = setup(consent)
    test.driver.start()
    await vi.waitFor(() => {
      expect(test.listener.onStatus).toHaveBeenLastCalledWith('idle')
    })
    expect(test.spawn).not.toHaveBeenCalled()
    expect(test.fetcher).not.toHaveBeenCalled()
    consent.mockResolvedValue(true)
    test.driver.start()
    await vi.waitFor(() => {
      expect(test.spawn).toHaveBeenCalledTimes(1)
    })
  })
  it('a new recording queues behind a warm helper draining its previous stop', async () => {
    const test = setup()
    await ready(test)
    test.driver.stop()
    test.driver.start()
    await vi.waitFor(() => {
      expect(test.child.sent).toEqual(['start', 'stop', 'start'])
    })
    test.child.emitLine({ type: 'text', text: 'last phrase' })
    test.child.emitLine({ type: 'stopped' })
    test.child.emitLine({ type: 'listening' })
    expect(test.child.sent).toEqual(['start', 'stop', 'start'])
    expect(test.spawn).toHaveBeenCalledTimes(1)
    expect(test.fetcher).toHaveBeenCalledTimes(1)
    expect(test.listener.onText).toHaveBeenCalledWith('last phrase')
    expect(test.listener.onStatus).toHaveBeenLastCalledWith('listening')
  })
  it('a late answer after Stop has no authority to download or capture', async () => {
    const test = await preparing()
    test.driver.stop()
    test.answer.resolve(true)
    await test.driver.reset()
    expect(test.fetcher).not.toHaveBeenCalled()
    expect(test.spawn).not.toHaveBeenCalled()
    expect(test.listener.onError).not.toHaveBeenCalled()
  })
  it('dispose during preparation prevents late capture', async () => {
    const test = await preparing()
    test.driver.dispose()
    test.answer.resolve(true)
    await test.driver.reset()
    test.listener.onStatus.mockClear()
    test.driver.start()
    expect(test.spawn).not.toHaveBeenCalled()
    expect(test.listener.onStatus).not.toHaveBeenCalled()
  })
  it('a new press during cancelled preparation retries after ownership is released', async () => {
    const first = Promise.withResolvers<boolean>()
    const consent = vi.fn(() => Promise.resolve(true)).mockImplementationOnce(() => first.promise)
    const test = setup(consent)
    test.driver.start()
    await vi.waitFor(() => {
      expect(consent).toHaveBeenCalledTimes(1)
    })
    test.driver.stop()
    test.driver.start()
    first.resolve(true)
    await vi.waitFor(() => {
      expect(test.spawn).toHaveBeenCalledTimes(1)
    })
    expect(consent).toHaveBeenCalledTimes(2)
    expect(test.fetcher).toHaveBeenCalledTimes(1)
    expect(test.listener.onError).not.toHaveBeenCalled()
  })
  it('a removed-model setting refuses capture, and reset kills a warm helper', async () => {
    const test = setup()
    test.isEnabled.mockReturnValue(false)
    test.driver.start()
    expect(test.listener.onError).toHaveBeenCalledWith(UI_TEXT.linuxDictationRemoved)
    expect(test.fetcher).not.toHaveBeenCalled()
    test.isEnabled.mockReturnValue(true)
    test.driver.start()
    await vi.waitFor(() => {
      expect(test.spawn).toHaveBeenCalledTimes(1)
    })
    await test.driver.reset()
    expect(test.child.killCount).toBe(1)
  })
  it('reports native helper errors using installed-language text', async () => {
    const test = setup()
    test.driver.start()
    await vi.waitFor(() => {
      expect(test.spawn).toHaveBeenCalledTimes(1)
    })
    test.child.emitLine({ type: 'error', reason: 'pulse-capture' })
    expect(test.listener.onError).toHaveBeenCalledWith(
      `${UI_TEXT.linuxDictationFailed}: pulse-capture`,
    )
    expect(test.child.killCount).toBe(1)
  })
})

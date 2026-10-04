// Voice's own bundle (M9, M35, PLAN.md D6): src/host/voice/voiceEntry.ts built
// as scripts/build.mjs builds it, then required by `voiceLoader` with Node's
// own `require`, as the first recording requires dist/voice.js. A driver
// handed out before then loads nothing; a recording that cannot load it
// fails as recordings fail, through `onError`, and the next press tries again.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DictationHandle, DictationListener } from '../../src/core/voice/dictation'
import { deferredDriver, isVoiceBundle, voiceLoader } from '../../src/host/voice/voiceBundle'
import { UI_TEXT, VOICE_BUNDLE_FILE } from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { builtForTests, lazyLoaderCases } from './helpers/lazyBundles'

const built = builtForTests('src/host/voice/voiceEntry.ts', VOICE_BUNDLE_FILE)

// A helper in Node itself that speaks the protocol: ready at once, listening
// and one phrase on "start", stopped on "stop", gone on "quit".
const HELPER = String.raw`
  const say = (line) => process.stdout.write(JSON.stringify(line) + "\n");
  say({ type: "ready", language: "en-US" });
  process.stdin.setEncoding("utf8");
  let tail = "";
  process.stdin.on("data", (chunk) => {
    const lines = (tail + chunk).split("\n"); tail = lines.pop();
    for (const line of lines) {
      if (line === "start") { say({ type: "listening" }); say({ type: "text", text: "hello" }); }
      if (line === "stop") { say({ type: "stopped" }); }
      if (line === "quit") { process.exit(0); }
    }
  });`
const INVOCATION = { command: process.execPath, args: ['-e', HELPER] }

/** A listener that records what the driver told it. */
function recorder() {
  const told = { statuses: [] as string[], texts: [] as string[], errors: [] as string[] }
  const stopped = Promise.withResolvers<undefined>()
  const failed = Promise.withResolvers<string>()
  const listener: DictationListener = {
    onStatus: (status) => {
      told.statuses.push(status)
    },
    onText: (text) => {
      told.texts.push(text)
    },
    onError: (reason) => {
      told.errors.push(reason)
      failed.resolve(reason)
    },
    onStopped: () => {
      stopped.resolve(undefined)
    },
  }
  return { told, listener, stopped: stopped.promise, failed: failed.promise }
}

function fakeDriver(): DictationHandle {
  return { start: vi.fn(), stop: vi.fn(), dispose: vi.fn() }
}

describe('isVoiceBundle', () => {
  it('accepts a module that exports both drivers, and nothing else', () => {
    expect(isVoiceBundle({ createDictation: fakeDriver, createMuseVoice: fakeDriver })).toBe(true)
    expect(isVoiceBundle({ createDictation: fakeDriver })).toBe(false)
    expect(isVoiceBundle({ createDictation: fakeDriver, createMuseVoice: 1 })).toBe(false)
    expect(isVoiceBundle(null)).toBe(false)
    expect(isVoiceBundle('createDictation')).toBe(false)
  })
})

describe('voiceLoader', () => {
  lazyLoaderCases(voiceLoader, built, () => UI_TEXT.dictationNotLoaded)
})

describe('deferredDriver', () => {
  it('makes nothing until the first start, then starts the driver it made on every press', () => {
    const driver = fakeDriver()
    const make = vi.fn(() => driver)
    const deferred = deferredDriver(recorder().listener, make)
    deferred.stop()
    expect(make).not.toHaveBeenCalled()
    deferred.start()
    deferred.stop()
    deferred.start()
    expect(make).toHaveBeenCalledOnce()
    expect(driver.start).toHaveBeenCalledTimes(2)
    expect(driver.stop).toHaveBeenCalledOnce()
    deferred.dispose()
    expect(driver.dispose).toHaveBeenCalledOnce()
  })

  it('says a driver that cannot be made through onError, never silently, and tries again on the next press', () => {
    const { told, listener } = recorder()
    const driver = fakeDriver()
    const make = vi
      .fn<() => DictationHandle>()
      .mockImplementationOnce(() => {
        throw new Error(UI_TEXT.dictationNotLoaded)
      })
      .mockImplementation(() => driver)
    const deferred = deferredDriver(listener, make)
    deferred.start()
    expect(told.errors).toEqual([UI_TEXT.dictationNotLoaded])
    expect(told.statuses).toEqual([])
    deferred.start()
    expect(make).toHaveBeenCalledTimes(2)
    expect(driver.start).toHaveBeenCalledOnce()
  })

  it('makes nothing once disposed', () => {
    const make = vi.fn(() => fakeDriver())
    const deferred = deferredDriver(recorder().listener, make)
    deferred.dispose()
    deferred.start()
    expect(make).not.toHaveBeenCalled()
  })
})

describe('the shipped voice bundle', () => {
  it('loads the shared English fallback without copying it', () => {
    const text = readFileSync(built.file, 'utf8')
    expect(text).toContain('require("./uiText.js")')
    expect(text).not.toContain(UI_TEXT.crashTitle)
  })

  it('records through a helper with its own driver: starting, listening, the phrase, idle, stopped', async () => {
    const voice = voiceLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })
    const { told, listener, stopped } = recorder()
    const driver = deferredDriver(listener, () =>
      voice().createDictation(
        INVOCATION,
        listener,
        new FakeLogOutputChannel(),
        UI_TEXT,
        uiLocale(),
      ),
    )
    driver.start()
    await vi.waitFor(() => {
      expect(told.texts).toEqual(['hello'])
    })
    driver.stop()
    await stopped
    driver.dispose()
    expect(told.statuses).toEqual(['starting', 'listening', 'idle'])
    expect(told.errors).toEqual([])
  })

  it('fails a Muse Voice recording in the table it is handed', async () => {
    const voice = voiceLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })
    const { listener, failed } = recorder()
    const driver = voice().createMuseVoice(
      {
        capture: { isAvailable: true, kind: 'helper', invocation: INVOCATION },
        apiKey: () => Promise.resolve(undefined),
        onSeconds: () => undefined,
        log: new FakeLogOutputChannel(),
      },
      listener,
      { ...UI_TEXT, museVoiceNoKey: 'Marker no key.' },
      uiLocale(),
    )
    driver.start()
    expect(await failed).toBe('Marker no key.')
    driver.dispose()
  })

  it('fails the first recording with the reason while the file is missing, and records once it is back', async () => {
    const log = new FakeLogOutputChannel()
    const folder = path.join(built.folder, 'reinstalled')
    const voice = voiceLoader({ bundlePath: path.join(folder, VOICE_BUNDLE_FILE), log })
    const { told, listener } = recorder()
    const driver = deferredDriver(listener, () =>
      voice().createDictation(INVOCATION, listener, log, UI_TEXT, uiLocale()),
    )
    driver.start()
    expect(told.errors).toEqual([UI_TEXT.dictationNotLoaded])
    expect(told.statuses).toEqual([])
    mkdirSync(folder)
    for (const file of [VOICE_BUNDLE_FILE, 'uiText.js']) {
      copyFileSync(path.join(built.folder, file), path.join(folder, file))
    }
    driver.start()
    await vi.waitFor(() => {
      expect(told.texts).toEqual(['hello'])
    })
    driver.dispose()
  })
})

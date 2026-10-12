// Voice's own bundle (M9, M35, PLAN.md D6): src/host/voice/voiceEntry.ts built
// as scripts/build.mjs builds it, then required by `voiceLoader` with Node's
// own `require`, as the first recording requires dist/voice.js. A driver
// handed out before then loads nothing; a recording that cannot load it
// fails as recordings fail, through `onError`, and the next press tries again.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { Usd } from '../../src/shared/usd'
import type { SessionBudgetJournal } from '../../src/core/backends/modelapi/sessionBudget'
import type { DictationHandle, DictationListener } from '../../src/core/voice/dictation'
import {
  deferredDriver,
  isVoiceBundle,
  ownedMetaVoiceBudgetScope,
  voiceLoader,
} from '../../src/host/voice/voiceBundle'
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
    void deferred.dispose()
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
    void deferred.dispose()
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
    await driver.dispose()
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
        reserveDaily: () => Promise.reject(new Error('No key must not reserve')),
        log: new FakeLogOutputChannel(),
      },
      listener,
      { ...UI_TEXT, museVoiceNoKey: 'Marker no key.' },
      uiLocale(),
    )
    driver.start()
    expect(await failed).toBe('Marker no key.')
    await driver.dispose()
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
    await driver.dispose()
  })
})

describe('Meta-owned voice budget (RVCM352 P2 identity)', () => {
  it('binds only Meta identity and keeps its context fence after journal initialization', async () => {
    const total = { spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }
    const read = vi.fn(() => Promise.resolve(total))
    const journal: SessionBudgetJournal = {
      read,
      reserve: () => Promise.reject(new Error('unused')),
      record: () => Promise.resolve(total),
    }
    const context = { isCurrent: true }
    const deps = {
      journal,
      sessionId: 'voice-parent',
      accountId: 'meta-key-digest',
      capUsd: () => Usd.from(1).toAmount(),
      isCurrent: () => context.isCurrent,
    }
    const scope = await ownedMetaVoiceBudgetScope(deps)
    expect(read).toHaveBeenCalledExactlyOnceWith('voice-parent', 'meta-key-digest')
    expect(scope?.journal).toBe(journal)
    expect(scope?.capUsd()).toBe(Usd.from(1).toAmount())
    expect(scope?.isStillAllowed('meta-key-digest')).toBe(true)
    expect(scope?.isStillAllowed('other-provider-digest')).toBe(false)
    expect(scope?.isStillAllowed(undefined)).toBe(false)
    context.isCurrent = false
    expect(scope?.isStillAllowed('meta-key-digest')).toBe(false)
    await expect(ownedMetaVoiceBudgetScope(deps)).rejects.toThrow(
      UI_TEXT.sessionBudgetVoiceContextChanged,
    )
    expect(await ownedMetaVoiceBudgetScope({ ...deps, journal: undefined })).toBeUndefined()
  })
})

it('production voice callbacks bind Meta scopes and never fall back to the conversation provider', async () => {
  const source = readFileSync(new URL('../../src/extension.ts', import.meta.url), 'utf8')
  const start = source.indexOf('          voiceAccountId:')
  const end = source.indexOf('          exports:', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const key: { current: string | undefined } = { current: 'voice-test-key' }
  const digest = createHash('sha256')
    .update(key.current ?? '')
    .digest('hex')
  const total = { spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }
  const journal: SessionBudgetJournal = {
    read: () => Promise.resolve(total),
    reserve: () => Promise.reject(new Error('unused')),
    record: () => Promise.resolve(total),
  }
  const bindings = {
    credentials: { getApiKey: () => Promise.resolve(key.current) },
    createHash,
    modelApi: {
      accountId: () => Promise.resolve(key.current === undefined ? 'provider-digest' : digest),
      ensureHost: () =>
        Promise.resolve({
          getOwnedBudgetScope: () =>
            Promise.resolve({
              sessionId: 'parent',
              accountId: digest,
              journal,
              isStillAllowed: (actual: string | undefined) => actual === 'provider-digest',
            }),
        }),
    },
    modelApiStore: () => ({ budget: journal }),
    auth: { admissionGeneration: 1, current: { backend: 'modelApi' } },
    currentSettings: () => ({ modelApiSessionBudgetUsd: Usd.from(1).toAmount() }),
    ownedMetaVoiceBudgetScope,
    isProjectTrusted: () => true,
    nativeStarts: { signal: new AbortController().signal },
    UI_TEXT,
    digest,
  }
  const done = Promise.withResolvers<unknown>()
  runInNewContext(
    `(async () => {
    const deps = ({${source.slice(start, end)}});
    const scope = await deps.ownedVoiceBudgetScope('parent');
    return { account: await deps.voiceAccountId(), scopeAccount: scope.accountId,
      metaAllowed: scope.isStillAllowed(digest), providerAllowed: scope.isStillAllowed('provider-digest') };
  })().then(resolve, reject)`,
    { ...bindings, resolve: done.resolve, reject: done.reject },
  )
  expect(await done.promise).toEqual({
    account: digest,
    scopeAccount: digest,
    metaAllowed: true,
    providerAllowed: false,
  })
  key.current = undefined
  const missing = Promise.withResolvers<unknown>()
  runInNewContext(`({${source.slice(start, end)}}).voiceAccountId().then(resolve, reject)`, {
    ...bindings,
    resolve: missing.resolve,
    reject: missing.reject,
  })
  expect(await missing.promise).toBeUndefined()
})

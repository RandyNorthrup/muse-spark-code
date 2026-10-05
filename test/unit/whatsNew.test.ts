// What's New after an update, as activation sees it (M99, PLAN.md D79): a
// fresh install shows nothing, an upgrade shows once and in one window only,
// a downgrade and the setting off show nothing, a fixes-only patch gets the
// notification, and nothing shows while a turn runs or the user types.

import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ReleaseNotes } from '../../src/core/whatsNew/whatsNewContent'
import {
  hasClaimedVersion,
  createWhatsNew,
  isWhatsNewBundle,
  type WhatsNewDeps,
  whatsNewLoader,
} from '../../src/host/whatsNew/whatsNew'
import type { WhatsNewPages } from '../../src/host/whatsNew/whatsNewPanel'
import {
  UI_TEXT,
  WHATS_NEW_IDLE_POLL_MS,
  WHATS_NEW_QUIET_MS,
  WHATS_NEW_SETTLE_MS,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'
import { removeFolder } from './helpers/temporaryFolders'
import { Uri } from './mocks/vscode'

const KEY = 'museSpark.whatsNewLastSeenVersion'
const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-whats-new-claims-')))
afterAll(() => removeFolder(root))
function claimsFolder(): string {
  return path.join(root, `claims-${globalThis.crypto.randomUUID()}`)
}

function release(version: string, isHighlighted: boolean): ReleaseNotes {
  return {
    version,
    date: '2026-10-05',
    highlights: isHighlighted ? [{ c: [], tries: [] }] : [],
    sections: [],
  }
}

/** A window: its own timers and pages, sharing `state` and `claims` with the others. */
function window(options: {
  readonly state: Map<string, unknown>
  readonly claims?: string
  readonly current?: string
  readonly releases?: readonly ReleaseNotes[]
  readonly isEnabled?: boolean
  readonly hasEarlierUse?: boolean
  readonly notifyAnswer?: string | undefined
}) {
  const log = new FakeLogOutputChannel()
  const pending: { run: () => void; ms: number }[] = []
  const opened: [string | undefined, boolean][] = []
  const pages: WhatsNewPages = {
    releases: () => options.releases ?? [release('0.13.0', true)],
    open: (from, isBackground) => {
      opened.push([from, isBackground])
    },
    dispose: vi.fn(),
  }
  const createWhatsNewPages = vi.fn(() => pages)
  let isBusy = false
  let msSinceLastEdit = Infinity
  let isEnabled = options.isEnabled ?? true
  const notify = vi.fn(() => Promise.resolve(options.notifyAnswer))
  const disable = vi.fn(() => {
    isEnabled = false
    return Promise.resolve()
  })
  const claims = options.claims ?? claimsFolder()
  const deps: WhatsNewDeps = {
    bundlePath: '/ext/dist/whatsNew.js',
    loadBundle: () => ({ createWhatsNewPages }),
    pages: {
      extensionUri: Uri.file('/ext'),
      contentPath: '/ext/dist/whatsNew.json',
      current: options.current ?? '0.13.0',
      isShownOnUpdate: () => isEnabled,
      setShownOnUpdate: () => Promise.resolve(),
    },
    log,
    state: {
      get: (key) => options.state.get(key),
      update: (key, value) => {
        options.state.set(key, value)
        return Promise.resolve()
      },
    },
    lastSeenKey: KEY,
    current: options.current ?? '0.13.0',
    hasEarlierUse: options.hasEarlierUse ?? true,
    isEnabled: () => isEnabled,
    disable,
    claim: (version) => hasClaimedVersion(claims, version, log),
    isBusy: () => isBusy,
    msSinceLastEdit: () => msSinceLastEdit,
    notify,
    schedule: (run, ms) => {
      const entry = { run, ms }
      pending.push(entry)
      return () => {
        const index = pending.indexOf(entry)
        if (index !== -1) {
          pending.splice(index, 1)
        }
      }
    },
  }
  const whatsNew = createWhatsNew(deps)
  /** Runs the next scheduled wait; its delay. */
  const tick = async (): Promise<number | undefined> => {
    const next = pending.shift()
    next?.run()
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    return next?.ms
  }
  return {
    whatsNew,
    log,
    opened,
    pending,
    notify,
    disable,
    createWhatsNewPages,
    tick,
    setBusy: (isNowBusy: boolean) => {
      isBusy = isNowBusy
    },
    setLastEdit: (ms: number) => {
      msSinceLastEdit = ms
    },
  }
}

describe('createWhatsNew', () => {
  it('records a fresh install and shows nothing', async () => {
    const state = new Map<string, unknown>()
    const w = window({ state, hasEarlierUse: false })
    await w.whatsNew.check()
    expect(state.get(KEY)).toBe('0.13.0')
    expect(w.pending).toHaveLength(0)
    expect(w.createWhatsNewPages).not.toHaveBeenCalled()
  })

  it('shows an upgrade once, in the background, after the window settles', async () => {
    const state = new Map<string, unknown>([[KEY, '0.12.1']])
    const w = window({ state })
    await w.whatsNew.check()
    expect(state.get(KEY)).toBe('0.13.0')
    expect(w.opened).toEqual([])
    expect(await w.tick()).toBe(WHATS_NEW_SETTLE_MS)
    expect(w.opened).toEqual([['0.12.1', true]])
    // The next activation of the same version shows nothing.
    const again = window({ state })
    await again.whatsNew.check()
    expect(again.pending).toHaveLength(0)
  })

  it('takes an upgrade from a version before this feature as one from an unknown version', async () => {
    const w = window({ state: new Map(), hasEarlierUse: true })
    await w.whatsNew.check()
    await w.tick()
    expect(w.opened).toEqual([[undefined, true]])
  })

  it('shows it in one window when several activate together after the update', async () => {
    const state = new Map<string, unknown>([[KEY, '0.12.1']])
    const claims = claimsFolder()
    const windows = [
      window({ state, claims }),
      window({ state, claims }),
      window({ state, claims }),
    ]
    await Promise.all(windows.map((w) => w.whatsNew.check()))
    await Promise.all(windows.map((w) => w.tick()))
    expect(windows.flatMap((w) => w.opened)).toEqual([['0.12.1', true]])
    expect(
      windows.filter((w) =>
        logLines(w.log).some((line) => line.includes('another window shows it')),
      ),
    ).toHaveLength(2)
  })

  it('shows nothing for the same version or a downgrade, and keeps the newer record', async () => {
    for (const previous of ['0.13.0', '0.14.0']) {
      const state = new Map<string, unknown>([[KEY, previous]])
      const w = window({ state })
      await w.whatsNew.check()
      expect(w.pending, previous).toHaveLength(0)
      expect(state.get(KEY)).toBe(previous)
    }
  })

  it('shows nothing with the setting off, and records the version', async () => {
    const state = new Map<string, unknown>([[KEY, '0.12.1']])
    const w = window({ state, isEnabled: false })
    await w.whatsNew.check()
    expect(w.pending).toHaveLength(0)
    expect(state.get(KEY)).toBe('0.13.0')
  })

  it('gives a fixes-only patch a quiet notification that opens the page or turns it off', async () => {
    const patch = [release('0.13.1', false)]
    const opens = window({
      state: new Map([[KEY, '0.13.0']]),
      current: '0.13.1',
      releases: patch,
      notifyAnswer: UI_TEXT.whatsNewOpen,
    })
    await opens.whatsNew.check()
    await opens.tick()
    expect(opens.notify).toHaveBeenCalledExactlyOnceWith(
      'Muse Spark Code updated to 0.13.1.',
      UI_TEXT.whatsNewOpen,
      UI_TEXT.whatsNewDontShowAgain,
    )
    expect(opens.opened).toEqual([['0.13.0', false]])

    const declines = window({
      state: new Map([[KEY, '0.13.0']]),
      current: '0.13.1',
      releases: patch,
      notifyAnswer: UI_TEXT.whatsNewDontShowAgain,
    })
    await declines.whatsNew.check()
    await declines.tick()
    expect(declines.disable).toHaveBeenCalledOnce()
    expect(declines.opened).toEqual([])

    const dismissed = window({
      state: new Map([[KEY, '0.13.0']]),
      current: '0.13.1',
      releases: patch,
      notifyAnswer: undefined,
    })
    await dismissed.whatsNew.check()
    await dismissed.tick()
    expect(dismissed.disable).not.toHaveBeenCalled()
    expect(dismissed.opened).toEqual([])
  })

  it('waits while a turn runs or the user types, then shows it', async () => {
    const w = window({ state: new Map([[KEY, '0.12.1']]) })
    await w.whatsNew.check()
    w.setBusy(true)
    expect(await w.tick()).toBe(WHATS_NEW_SETTLE_MS)
    expect(w.opened).toEqual([])
    w.setBusy(false)
    w.setLastEdit(WHATS_NEW_QUIET_MS - 1)
    expect(await w.tick()).toBe(WHATS_NEW_IDLE_POLL_MS)
    expect(w.opened).toEqual([])
    w.setLastEdit(WHATS_NEW_QUIET_MS)
    expect(await w.tick()).toBe(WHATS_NEW_IDLE_POLL_MS)
    expect(w.opened).toEqual([['0.12.1', true]])
  })

  it('shows nothing when there are no notes, or after the window closes', async () => {
    const empty = window({ state: new Map([[KEY, '0.12.1']]), releases: [] })
    await empty.whatsNew.check()
    await empty.tick()
    expect(empty.opened).toEqual([])
    expect(logLines(empty.log).some((line) => line.includes('no release notes for 0.13.0'))).toBe(
      true,
    )

    const closed = window({ state: new Map([[KEY, '0.12.1']]) })
    await closed.whatsNew.check()
    closed.whatsNew.dispose()
    expect(closed.pending).toHaveLength(0)
    expect(closed.opened).toEqual([])
  })

  it('logs, and never says, a page that fails after an update', async () => {
    const state = new Map<string, unknown>([[KEY, '0.12.1']])
    const w = window({ state })
    w.createWhatsNewPages.mockImplementation(() => {
      throw new Error('broken content')
    })
    await w.whatsNew.check()
    await w.tick()
    expect(logLines(w.log).some((line) => line.includes('failed: broken content'))).toBe(true)
    expect(w.notify).not.toHaveBeenCalled()
  })

  it('opens the current version’s page with the keyboard from the command', () => {
    const w = window({ state: new Map([[KEY, '0.13.0']]) })
    w.whatsNew.show()
    w.whatsNew.show()
    expect(w.opened).toEqual([
      [undefined, false],
      [undefined, false],
    ])
    expect(w.createWhatsNewPages).toHaveBeenCalledOnce()
    w.whatsNew.dispose()
  })
})

describe('hasClaimedVersion', () => {
  it('claims a version once, and removes the claims of other versions', async () => {
    const dir = claimsFolder()
    const log = new FakeLogOutputChannel()
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '0.12.1.claim'), '')
    writeFileSync(path.join(dir, 'unrelated.txt'), '')
    expect(await hasClaimedVersion(dir, '0.13.0', log)).toBe(true)
    expect(await hasClaimedVersion(dir, '0.13.0', log)).toBe(false)
    expect(readdirSync(dir).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
      '0.13.0.claim',
      'unrelated.txt',
    ])
  })

  it('lets the window show it when the claim cannot be written, and says why in the log', async () => {
    const file = claimsFolder()
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'a file where the folder would be')
    const log = new FakeLogOutputChannel()
    expect(await hasClaimedVersion(file, '0.13.0', log)).toBe(true)
    expect(await hasClaimedVersion(path.join(file, 'below'), '0.13.0', log)).toBe(true)
    expect(logLines(log).some((line) => line.includes('could not record its claim'))).toBe(true)
  })

  it('refuses a text that is not a version as a file name', async () => {
    await expect(
      hasClaimedVersion(claimsFolder(), '../x', new FakeLogOutputChannel()),
    ).rejects.toThrow('Not a semantic version')
  })
})

describe('whatsNewLoader', () => {
  it('accepts a module that exports the page factory, and nothing else', () => {
    expect(isWhatsNewBundle({ createWhatsNewPages: () => undefined })).toBe(true)
    expect(isWhatsNewBundle({ createWhatsNewPages: 1 })).toBe(false)
    expect(isWhatsNewBundle({})).toBe(false)
    expect(isWhatsNewBundle(null)).toBe(false)
  })

  it('refuses a module that is not the bundle with the reason', () => {
    const load = whatsNewLoader({
      bundlePath: '/ext/dist/whatsNew.js',
      log: new FakeLogOutputChannel(),
      loadBundle: () => ({ somethingElse: true }),
    })
    expect(() => load()).toThrow(UI_TEXT.whatsNewUnavailable)
  })
})

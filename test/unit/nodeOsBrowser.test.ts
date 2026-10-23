// M110os OS7: the Chrome consent gate and the package-key check. The
// consent machine runs over the real store; check-key runs as a child
// process against the recorded Google keyring and transcript
// (test/fixtures/nodeos-chrome/CAPTURE.md). Live-gpg cases run only
// where gpg exists (shellSyntax's tool-gated precedent); the transcript
// cases run everywhere.
import { execFileSync } from 'node:child_process'
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type NodeOsRun, cleanup, runNodeScript, scratch, sha256File } from './helpers/nodeOs'
import {
  acceptChromeTerms,
  createBrowserState,
  loadBrowserState,
  recordChromeInstalled,
  requestChromeInstall,
  saveBrowserState,
} from '../../src/runtime/node/browser/chromeConsent'

const CHECK_KEY = fileURLToPath(new URL('../../os/addons/chrome/check-key.mjs', import.meta.url))
const PINS = fileURLToPath(new URL('../../os/addons/chrome/fingerprints.txt', import.meta.url))
const KEYRING = fileURLToPath(
  new URL('../../test/fixtures/nodeos-chrome/linux_signing_key.pub', import.meta.url),
)
const TRANSCRIPT = fileURLToPath(
  new URL('../../test/fixtures/nodeos-chrome/colons.txt', import.meta.url),
)
const GOOGLE_PRIMARY = 'EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796'

function hasGpg(): boolean {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const HAS_GPG = hasGpg()

function checkKey(args: string[], env?: NodeJS.ProcessEnv): NodeOsRun {
  return env === undefined
    ? runNodeScript(CHECK_KEY, args)
    : runNodeScript(CHECK_KEY, args, { env })
}

describe('chrome consent', () => {
  it('installs only after the terms and the click', () => {
    const fresh = createBrowserState()
    expect(fresh.defaultBrowser).toBe('chromium')
    expect(requestChromeInstall(fresh, true)).toEqual({ ok: false, reason: 'terms' })
    const accepted = acceptChromeTerms(fresh)
    expect(requestChromeInstall(accepted, false)).toEqual({ ok: false, reason: 'click' })
    const requested = requestChromeInstall(accepted, true)
    if (!requested.ok) throw new Error('unreachable')
    expect(requestChromeInstall(requested.state, true).ok).toBe(true)
    const installed = recordChromeInstalled(requested.state, {
      version: '156.0.8078.48',
      keyFingerprint: GOOGLE_PRIMARY.toLowerCase(),
      pinned: [GOOGLE_PRIMARY],
    })
    expect(installed.chromeInstalled).toBe(true)
    expect(installed.defaultBrowser).toBe('chrome')
    expect(installed.chromeKeyFingerprint).toBe(GOOGLE_PRIMARY)
    expect(requestChromeInstall(installed, true)).toEqual({ ok: false, reason: 'installed' })
  })

  it('refuses installs without a request or with bad evidence', () => {
    const fresh = createBrowserState()
    expect(() =>
      recordChromeInstalled(acceptChromeTerms(fresh), {
        version: '156.0.8078.48',
        keyFingerprint: GOOGLE_PRIMARY,
        pinned: [GOOGLE_PRIMARY],
      }),
    ).toThrow('chrome install was not requested')
    const requested = requestChromeInstall(acceptChromeTerms(fresh), true)
    if (!requested.ok) throw new Error('unreachable')
    expect(() =>
      recordChromeInstalled(requested.state, {
        version: '156.0.8078.48',
        keyFingerprint: '0'.repeat(40),
        pinned: [GOOGLE_PRIMARY],
      }),
    ).toThrow('chrome install evidence is not valid')
    expect(() =>
      recordChromeInstalled(requested.state, {
        version: '',
        keyFingerprint: GOOGLE_PRIMARY,
        pinned: [GOOGLE_PRIMARY],
      }),
    ).toThrow('chrome install evidence is not valid')
  })

  it('round-trips the browser state owner-only', () => {
    const dir = scratch('node-os-browser-')
    try {
      expect(loadBrowserState(dir)).toBeNull()
      const state = requestChromeInstall(acceptChromeTerms(createBrowserState()), true)
      if (!state.ok) throw new Error('unreachable')
      saveBrowserState(dir, state.state)
      expect(loadBrowserState(dir)).toEqual(state.state)
      writeFileSync(path.join(dir, 'browser.json'), '{oops')
      expect(() => loadBrowserState(dir)).toThrow('browser state is not valid')
    } finally {
      cleanup(dir)
    }
  })
})

describe('check-key', () => {
  it('matches the recorded keyring transcript against the real pins', () => {
    const run = checkKey(['--transcript', TRANSCRIPT, '--fingerprints', PINS])
    expect(run.status).toBe(0)
    expect(run.out).toContain('all 1 pinned fingerprints')
  })

  it('pins the recorded keyring against drift', () => {
    expect(sha256File(KEYRING)).toBe(
      '54dea5f6c2a26091578cf52a999cebc6b64df478d37ad4dce96376b711e3b27c',
    )
    expect(readFileSync(TRANSCRIPT, 'utf8')).toContain(GOOGLE_PRIMARY)
  })

  it('refuses a transcript that lost the pin, and tolerates garbage lines', () => {
    const dir = scratch('node-os-check-key-')
    try {
      const recorded = readFileSync(TRANSCRIPT, 'utf8')
      const dropped = path.join(dir, 'dropped.txt')
      writeFileSync(
        dropped,
        recorded
          .split('\n')
          .filter((line) => !line.includes(GOOGLE_PRIMARY))
          .join('\n'),
      )
      const missing = checkKey(['--transcript', dropped, '--fingerprints', PINS])
      expect(missing.status).toBe(1)
      expect(missing.out).toContain(GOOGLE_PRIMARY)
      const noisy = path.join(dir, 'noisy.txt')
      writeFileSync(noisy, `${recorded}\nnot-a-colons-line\nfpr:::::::::short:\n`)
      expect(checkKey(['--transcript', noisy, '--fingerprints', PINS]).status).toBe(0)
      const wrong = path.join(dir, 'wrong.txt')
      writeFileSync(wrong, `${'0'.repeat(40)}  Nobody\n`)
      expect(checkKey(['--transcript', TRANSCRIPT, '--fingerprints', wrong]).status).toBe(1)
    } finally {
      cleanup(dir)
    }
  })

  it('refuses bad input with a usage error', () => {
    const dir = scratch('node-os-check-key-input-')
    try {
      expect(checkKey([]).status).toBe(2)
      expect(checkKey(['--transcript', TRANSCRIPT]).status).toBe(2)
      expect(
        checkKey(['--transcript', TRANSCRIPT, '--fingerprints', PINS, '--keyring', KEYRING]).status,
      ).toBe(2)
      const malformed = path.join(dir, 'malformed.txt')
      writeFileSync(malformed, 'not-a-fingerprint\n')
      const bad = checkKey(['--transcript', TRANSCRIPT, '--fingerprints', malformed])
      expect(bad.status).toBe(2)
      expect(bad.out).toContain('not a fingerprint')
      const empty = path.join(dir, 'empty.txt')
      writeFileSync(empty, '# only a comment\n')
      expect(checkKey(['--transcript', TRANSCRIPT, '--fingerprints', empty]).status).toBe(2)
      const linked = path.join(dir, 'linked')
      symlinkSync(dir, linked)
      expect(checkKey(['--transcript', linked, '--fingerprints', PINS]).status).toBe(2)
      expect(
        checkKey(['--transcript', path.join(dir, 'absent.txt'), '--fingerprints', PINS]).status,
      ).toBe(2)
    } finally {
      cleanup(dir)
    }
  })

  it('says when gpg is missing', () => {
    const env = { ...process.env, PATH: '' }
    const run = checkKey(['--keyring', KEYRING, '--fingerprints', PINS], env)
    expect(run.status).toBe(2)
    expect(run.out).toContain('gpg not found')
    const explicit = checkKey([
      '--keyring',
      KEYRING,
      '--fingerprints',
      PINS,
      '--gpg',
      path.join(tmpdir(), 'node-os-no-gpg-here'),
    ])
    expect(explicit.status).toBe(2)
  })

  it.runIf(HAS_GPG)('matches the recorded keyring with the real gpg', () => {
    const run = checkKey(['--keyring', KEYRING, '--fingerprints', PINS])
    expect(run.status).toBe(0)
    expect(run.out).toContain('all 1 pinned fingerprints')
  })

  it.runIf(HAS_GPG)('refuses a wrong pin and a missing keyring with the real gpg', () => {
    const dir = scratch('node-os-check-key-live-')
    try {
      const wrong = path.join(dir, 'wrong.txt')
      writeFileSync(wrong, `${'0'.repeat(40)}  Nobody\n`)
      const mismatch = checkKey(['--keyring', KEYRING, '--fingerprints', wrong])
      expect(mismatch.status).toBe(1)
      expect(mismatch.out).toContain('0'.repeat(40))
      const absent = checkKey(['--keyring', path.join(dir, 'absent.pub'), '--fingerprints', PINS])
      expect(absent.status).toBe(2)
      expect(absent.out).toContain('keyring not found')
      const garbage = path.join(dir, 'garbage.pub')
      writeFileSync(garbage, 'not a keyring\n')
      const unusable = checkKey(['--keyring', garbage, '--fingerprints', PINS])
      expect(unusable.status).toBe(2)
      expect(unusable.out).toContain('no keys imported')
    } finally {
      cleanup(dir)
    }
  })
})

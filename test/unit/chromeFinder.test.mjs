import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { fakeProcess } = vi.hoisted(() => ({ fakeProcess: { platform: 'linux', env: {} } }))
vi.mock('node:process', () => ({ default: fakeProcess }))
import { findChrome } from '../../scripts/lib/chrome.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  delete fakeProcess.env.PATH
  delete fakeProcess.env.CHROME_PATH
})

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'chrome-finder-'))
  roots.push(root)
  const missing = path.join(root, 'missing')
  const installed = path.join(root, 'installed browser')
  mkdirSync(missing)
  mkdirSync(installed)
  fakeProcess.env.PATH = [missing, installed].join(path.delimiter)
  return { root, installed }
}

function executable(folder, name) {
  const file = path.join(folder, name)
  writeFileSync(file, '#!/bin/sh\nexit 0\n')
  chmodSync(file, 0o755)
  return file
}

describe('shared browser finder', () => {
  it('finds a PATH-only Chromium install after unavailable Chrome names', () => {
    const { installed } = fixture()
    const chromium = executable(installed, 'chromium')
    expect(findChrome()).toBe(chromium)
    expect(path.isAbsolute(findChrome())).toBe(true)
  })

  it('keeps the candidate preference when multiple browsers are installed', () => {
    const { installed } = fixture()
    executable(installed, 'chromium')
    const chrome = executable(installed, 'google-chrome-stable')
    expect(findChrome()).toBe(chrome)
  })

  it('resolves an explicit PATH name before the ordinary candidates', () => {
    const { installed } = fixture()
    executable(installed, 'google-chrome')
    const chromium = executable(installed, 'chromium')
    fakeProcess.env.CHROME_PATH = 'chromium'
    expect(findChrome()).toBe(chromium)
  })

  it('keeps an explicit executable authoritative even outside PATH', () => {
    const { root, installed } = fixture()
    executable(installed, 'google-chrome')
    const browser = executable(root, 'chosen browser')
    fakeProcess.env.CHROME_PATH = browser
    expect(findChrome()).toBe(browser)
  })

  it('resolves an explicit relative executable from the current directory', () => {
    const { root } = fixture()
    const browser = executable(root, 'chosen browser')
    fakeProcess.env.CHROME_PATH = path.relative(process.cwd(), browser)
    expect(findChrome()).toBe(browser)
  })

  it('refuses missing installs and missing explicit overrides', () => {
    const { root, installed } = fixture()
    expect(findChrome()).toBeUndefined()
    executable(installed, 'google-chrome')
    fakeProcess.env.CHROME_PATH = path.join(root, 'absent')
    expect(findChrome()).toBeUndefined()
    fakeProcess.env.CHROME_PATH = installed
    expect(findChrome()).toBeUndefined()
    fakeProcess.env.CHROME_PATH = ''
    expect(findChrome()).toBeUndefined()
  })
})

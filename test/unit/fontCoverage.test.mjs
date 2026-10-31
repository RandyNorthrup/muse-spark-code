// Muse Desktop (M111, D91.20) lane IN: the font-coverage gate shapes every
// UI codepoint with HarfBuzz against the image's fonts. Collection must
// carry every shaped codepoint with its attribution and skip what has no
// glyph (controls); the cluster mapping must read HarfBuzz's answer; the
// declared families must stay packaged in os/desktop/packages.conf; and
// the CLI must fail closed with exit 2 on bad input or a missing tool.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  IMAGE_FONTS,
  OS_DESKTOP_PACKAGES,
  collectCodepoints,
  loadUiStrings,
  missingCodepoints,
} from '../../scripts/lib/fontCoverage.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLI = path.join(root, 'scripts/check-font-coverage.mjs')

// Recorded 2026-10-30 on linuxlt: hb-shape 10.2.0 (Debian trixie
// libharfbuzz-bin 10.2.0-1+deb13u1) shaping NotoSans-Regular.ttf with
// --output-format=json --no-glyph-names.
const COVERED_SINGLE = [{ g: 36, cl: 0, dx: 0, dy: 0, ax: 639, ay: 0 }]
const MISSING_SINGLE = [{ g: 0, cl: 0, dx: 0, dy: 0, ax: 600, ay: 0 }]
const SEPARATED = [
  { g: 36, cl: 0, dx: 0, dy: 0, ax: 639, ay: 0 },
  { g: 3, cl: 1, dx: 0, dy: 0, ax: 260, ay: 0 },
  { g: 0, cl: 2, dx: 0, dy: 0, ax: 600, ay: 0 },
]

const shared = {}
beforeAll(async () => {
  shared.strings = await loadUiStrings(root)
})

const scratch = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempRoot() {
  mkdirSync(path.join(root, 'temp'), { recursive: true })
  const dir = mkdtempSync(path.join(root, 'temp', 'in-fonts-'))
  scratch.push(dir)
  return dir
}
function runCli(args, options = {}) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      ...options,
    })
    return { status: 0, output }
  } catch (error) {
    return { status: error.status, output: String(error.stdout ?? '') }
  }
}

describe('M111 lane IN font coverage', () => {
  it('collects shaped codepoints with attribution and skips controls', () => {
    const { locales, flattened } = shared.strings
    const shaped = collectCodepoints(locales, flattened)
    expect(shaped.length).toBeGreaterThan(2000)
    expect(shaped.find((entry) => entry.codepoint === 0x03_01)).toEqual({
      codepoint: 0x03_01,
      locale: 'ru',
      key: 'languageServer.budgetReached',
    })
    expect(shaped.find((entry) => entry.codepoint === 0x21_91)?.locale).toBe('en')
    expect(['zh-cn', 'zh-tw', 'ja', 'ko']).toContain(
      shaped.find((entry) => entry.codepoint === 0x4e_2d)?.locale,
    )
    expect(shaped.some((entry) => entry.codepoint === 0x00_0a)).toBe(false)
  })

  it('reads HarfBuzz clusters, including the separator mapping', () => {
    expect(missingCodepoints(COVERED_SINGLE, 1)).toEqual([])
    expect(missingCodepoints(MISSING_SINGLE, 1)).toEqual([0])
    // Codepoint i owns cluster 2i; the separators' odd clusters are ignored.
    expect(missingCodepoints(SEPARATED, 2)).toEqual([1])
    expect(missingCodepoints([], 2)).toEqual([0, 1])
  })

  it('keeps every declared family packaged in os/desktop', () => {
    const list = readFileSync(path.join(root, OS_DESKTOP_PACKAGES), 'utf8')
    for (const { family, packages } of IMAGE_FONTS) {
      if (!list.includes(packages))
        throw new Error(`${family}: ${packages} is not in ${OS_DESKTOP_PACKAGES}`)
    }
  })

  it('refuses bad arguments with exit 2', () => {
    const run = runCli(['--bogus'], { cwd: root })
    expect(run.status).toBe(2)
    expect(run.output).toContain('usage:')
  })

  it('fails closed on a root without tables', () => {
    const run = runCli(['--root', tempRoot()], { cwd: root })
    expect(run.status).toBe(2)
    expect(run.output).toContain('src/shared/l10n is missing')
  })

  it('fails closed without fontconfig', () => {
    const run = runCli([], { cwd: root, env: { ...process.env, PATH: tempRoot() } })
    expect(run.status).toBe(2)
    expect(run.output).toContain('fc-match is missing')
  })

  it('behaves the same through a symlinked directory', () => {
    const target = tempRoot()
    const link = path.join(tempRoot(), 'linked')
    symlinkSync(target, link, 'junction')
    const direct = runCli(['--root', target], { cwd: root })
    const linked = runCli(['--root', link], { cwd: root })
    expect(linked).toEqual(direct)
    expect(linked.status).toBe(2)
  })
})

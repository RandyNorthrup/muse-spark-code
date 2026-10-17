// The browser check's runtime pin (M81 A1, design spec v4 §4.2): the shipped
// browserRuntime.json validates and agrees with itself, its publication
// record is the immutable ChromiumDash one, the platform comes from the OS
// and processor, and freshness is exact integer milliseconds at both
// boundaries (45 days for checks, 14 days of lag for release and weekly CI).
import { describe, expect, it } from 'vitest'
import {
  isPinCurrent,
  isPinFresh,
  parseRuntimeManifest,
  runtimePlatform,
} from '../../src/core/browser/runtime/runtimeManifest'
import shipped from '../../src/host/browser/runtime/browserRuntime.json'

const DAY = 86_400_000
const PUBLISHED = 1_790_706_629_983

/** A copy of the shipped pin a test may change. */
function copy(): typeof shipped {
  return structuredClone(shipped)
}

describe('the shipped runtime pin (M81 A1)', () => {
  it('validates, pins Chrome for Testing 154.0.8037.92 and keeps its immutable publication record', () => {
    const manifest = parseRuntimeManifest(shipped)
    expect(manifest?.version).toBe('154.0.8037.92')
    expect(manifest?.revision).toBe('1689415')
    // The ChromiumDash Stable records for this exact version (spec §4.2):
    // the earliest desktop one is the pin's date; a republish never moves it.
    expect(manifest?.publication).toEqual({
      version: '154.0.8037.92',
      channel: 'Stable',
      sources: [
        'https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Windows&num=200',
        'https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Linux&num=200',
        'https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=200',
      ],
      platformTimes: { Windows: 1_790_706_643_713, Linux: PUBLISHED, Mac: 1_790_706_647_592 },
      publishedAtMs: PUBLISHED,
      publishedAt: '2026-09-29T18:30:29.983Z',
    })
  })

  it('names, for each platform, the archive and executable the release took from the archives themselves', () => {
    const manifest = parseRuntimeManifest(shipped)
    expect(Object.keys(manifest?.platforms ?? {})).toEqual([
      'win64',
      'linux64',
      'mac-x64',
      'mac-arm64',
    ])
    const records = Object.entries(manifest?.platforms ?? {})
    for (const [platform, record] of records) {
      expect(record.url, platform).toBe(
        `https://storage.googleapis.com/chrome-for-testing-public/154.0.8037.92/${platform}/chrome-headless-shell-${platform}.zip`,
      )
      expect(record.executable.startsWith(`chrome-headless-shell-${platform}/`), platform).toBe(
        true,
      )
      expect(record.executableEntries, platform).toContain(record.executable)
      expect(record.extractedBytes, platform).toBeLessThan(400 * 1024 * 1024)
    }
    expect(manifest?.platforms.linux64.archiveSha256).toBe(
      '636aa5c79f2693632e9921b8bbb050038ba11672e02346c06c20f991aed096f9',
    )
  })

  it('refuses a manifest that is not one, or whose records disagree', () => {
    expect(parseRuntimeManifest({})).toBeUndefined()
    const later = copy()
    later.publication.publishedAtMs = 1_790_706_643_713
    expect(parseRuntimeManifest(later)).toBeUndefined()
    const rendering = copy()
    rendering.publication.publishedAt = '2026-09-30T00:00:00.000Z'
    expect(parseRuntimeManifest(rendering)).toBeUndefined()
    const elsewhere = copy()
    elsewhere.platforms.linux64.url =
      'https://example.com/chrome-for-testing-public/154.0.8037.92/x.zip'
    expect(parseRuntimeManifest(elsewhere)).toBeUndefined()
    const otherVersion = copy()
    otherVersion.platforms.win64.url = otherVersion.platforms.win64.url.replace(
      '154.0.8037.92',
      '155.0.1.1',
    )
    expect(parseRuntimeManifest(otherVersion)).toBeUndefined()
    const notExecutable = copy()
    notExecutable.platforms['mac-x64'].executableEntries = [
      'chrome-headless-shell-mac-x64/libEGL.dylib',
    ]
    expect(parseRuntimeManifest(notExecutable)).toBeUndefined()
    const extra = { ...copy(), note: 'x' }
    expect(parseRuntimeManifest(extra)).toBeUndefined()
    const traversal = copy()
    traversal.platforms.linux64.executable = '../chrome-headless-shell'
    expect(parseRuntimeManifest(traversal)).toBeUndefined()
  })

  it('maps this OS and processor to its pinned platform, and any other to none', () => {
    expect(runtimePlatform('win32', 'x64')).toBe('win64')
    expect(runtimePlatform('linux', 'x64')).toBe('linux64')
    expect(runtimePlatform('darwin', 'x64')).toBe('mac-x64')
    expect(runtimePlatform('darwin', 'arm64')).toBe('mac-arm64')
    expect(runtimePlatform('win32', 'arm64')).toBeUndefined()
    expect(runtimePlatform('linux', 'arm64')).toBeUndefined()
    expect(runtimePlatform('win32', 'ia32')).toBeUndefined()
    expect(runtimePlatform('freebsd', 'x64')).toBeUndefined()
  })
})

describe('the pin’s freshness (M81 A1)', () => {
  it('refuses checks from exactly 45 days after the publication, never a millisecond before', () => {
    const expiry = PUBLISHED + 45 * DAY
    expect(new Date(expiry).toISOString()).toBe('2026-11-13T18:30:29.983Z')
    expect(isPinFresh(PUBLISHED, expiry - 1)).toBe(true)
    expect(isPinFresh(PUBLISHED, expiry)).toBe(false)
    expect(isPinFresh(PUBLISHED, expiry + 1)).toBe(false)
    expect(isPinFresh(PUBLISHED, PUBLISHED)).toBe(true)
  })

  it('refuses a future, unknown or malformed date and a clock earlier than the publication', () => {
    expect(isPinFresh(PUBLISHED, PUBLISHED - 1)).toBe(false)
    expect(isPinFresh(NaN, PUBLISHED)).toBe(false)
    expect(isPinFresh(PUBLISHED + 0.5, PUBLISHED + DAY)).toBe(false)
    expect(isPinFresh(PUBLISHED, Infinity)).toBe(false)
  })

  it('fails release and weekly CI only past 14 days of lag: exactly 14 days passes', () => {
    expect(isPinCurrent(PUBLISHED, PUBLISHED + 14 * DAY - 1)).toBe(true)
    expect(isPinCurrent(PUBLISHED, PUBLISHED + 14 * DAY)).toBe(true)
    expect(isPinCurrent(PUBLISHED, PUBLISHED + 14 * DAY + 1)).toBe(false)
    expect(isPinCurrent(PUBLISHED, NaN)).toBe(false)
  })

  it('keeps an old pin’s date when a new extension version ships it again', () => {
    // A republish copies the record unchanged: the date is the version's,
    // never the extension release's, so an old pin still expires on time.
    const republished = parseRuntimeManifest(structuredClone(shipped))
    expect(republished?.publication.publishedAtMs).toBe(PUBLISHED)
    expect(isPinFresh(republished?.publication.publishedAtMs ?? 0, PUBLISHED + 45 * DAY)).toBe(
      false,
    )
  })
})

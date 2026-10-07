import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../../scripts/lib/harnessServer.mjs'
import {
  checkCoverage,
  checkReadmeBudget,
  describeShot,
  parseArgs,
  parseShotList,
  readmeImageRefs,
  shotUrl,
} from '../../scripts/readme-shots.mjs'

function fingerprint(files) {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(`${file}\0`)
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

const list = parseShotList(readFileSync('scripts/readme-shots.json', 'utf8'))
const readme = readFileSync('README.md', 'utf8')
const harness = readFileSync('test/harness/index.html', 'utf8')

function hasStepKey(scenario) {
  return new RegExp(String.raw`(?:^|\n)\s*['"]?${scenario}['"]?: \(\) =>`).test(harness)
}

function textOf(shots, excluded = []) {
  return JSON.stringify({ shots, excluded })
}

describe('readme shot list', () => {
  it('names a harness scenario that test/harness/index.html plays, per entry', () => {
    expect(list.shots.length).toBeGreaterThan(0)
    for (const shot of list.shots) {
      expect(SCENARIOS, `${shot.file}: scenario`).toContain(shot.scenario)
      expect(hasStepKey(shot.scenario), `${shot.file}: harness step`).toBe(true)
    }
  })

  it('covers every README image and lists nothing the README never shows', () => {
    const { missingEntries, unreferenced } = checkCoverage(list, readmeImageRefs(readme))
    expect({ missingEntries, unreferenced }).toEqual({ missingEntries: [], unreferenced: [] })
  })

  it('keeps the banner out with its reason', () => {
    expect(list.excluded).toEqual([
      {
        file: 'media/readme/banner.png',
        reason: expect.stringContaining('render-images'),
      },
    ])
  })
})

describe('M114 bounded README media', () => {
  it('keeps the actual curated set below 2 MiB and fails an oversized set', () => {
    const sizes = readmeImageRefs(readme).map((file) => readFileSync(file).length)
    expect(checkReadmeBudget(sizes)).toBeGreaterThan(0)
    expect(() => checkReadmeBudget([2 * 1024 * 1024 + 1])).toThrow('2 MiB budget')
  })
})

describe('readme-shots arguments', () => {
  it('defaults to every shot into media/readme', () => {
    expect(parseArgs([])).toEqual({ only: null, out: 'media/readme', list: false })
  })

  it('takes --list, --only names and --out dir, joined or split', () => {
    expect(parseArgs(['--list'])).toEqual({ only: null, out: 'media/readme', list: true })
    expect(parseArgs(['--only=turn,agents.png'])).toEqual({
      only: ['turn', 'agents'],
      out: 'media/readme',
      list: false,
    })
    expect(parseArgs(['--only', 'turn', '--out', 'temp/readme-preview'])).toEqual({
      only: ['turn'],
      out: 'temp/readme-preview',
      list: false,
    })
    expect(parseArgs(['--out=temp/readme-preview'])).toEqual({
      only: null,
      out: 'temp/readme-preview',
      list: false,
    })
  })

  it('refuses an unknown flag and empty values', () => {
    expect(() => parseArgs(['turn'])).toThrow('Unknown argument')
    expect(() => parseArgs(['--only='])).toThrow('--only')
    expect(() => parseArgs(['--only=,.png'])).toThrow('--only')
    expect(() => parseArgs(['--only'])).toThrow('--only needs a value')
    expect(() => parseArgs(['--only', '--list'])).toThrow('--only needs a value')
    expect(() => parseArgs(['--out='])).toThrow('--out')
    expect(() => parseArgs(['--out'])).toThrow('--out needs a directory')
  })
})

describe('readme-shots list validation', () => {
  const shot = {
    file: 'media/readme/turn.png',
    scenario: 'tools',
    theme: 'light',
    width: 690,
    height: 760,
    note: 'A turn',
  }
  it('refuses a broken list', () => {
    expect(() => parseShotList('not json')).toThrow('not valid JSON')
    expect(() => parseShotList('{}')).toThrow('"shots" array')
    expect(() => parseShotList(textOf([{ ...shot, scenario: 'nope' }]))).toThrow(
      'unknown harness scenario',
    )
    expect(() => parseShotList(textOf([{ ...shot, theme: 'sepia' }]))).toThrow('theme')
    expect(() => parseShotList(textOf([{ ...shot, width: 0 }]))).toThrow('width and height')
    expect(() => parseShotList(textOf([{ ...shot, lang: 'xx!' }]))).toThrow('lang')
    expect(() => parseShotList(textOf([{ ...shot, note: '  ' }]))).toThrow('note')
    expect(() => parseShotList(textOf([shot, shot]))).toThrow('twice')
    expect(() => parseShotList(textOf([shot], [{ file: 'media/readme/banner.png' }]))).toThrow(
      'reason',
    )
  })

  it('accepts a language id and builds its URL', () => {
    const [german] = parseShotList(textOf([{ ...shot, lang: 'de' }])).shots
    expect(shotUrl(1234, german)).toBe(
      'http://127.0.0.1:1234/test/harness/index.html?scenario=tools&theme=light&lang=de',
    )
    expect(shotUrl(1234, shot)).toBe(
      'http://127.0.0.1:1234/test/harness/index.html?scenario=tools&theme=light',
    )
  })

  it('describes a shot with its mapping', () => {
    expect(describeShot(shot)).toContain('media/readme/turn.png <- tools')
  })

  it('finds gaps in both directions', () => {
    const { missingEntries, unreferenced } = checkCoverage({ shots: [shot], excluded: [] }, [
      'media/readme/turn.png',
      'media/readme/stray.png',
    ])
    expect(missingEntries).toEqual(['media/readme/stray.png'])
    expect(unreferenced).toEqual([])
    const swapped = checkCoverage({ shots: [], excluded: [] }, ['media/readme/turn.png'])
    expect(swapped.missingEntries).toEqual(['media/readme/turn.png'])
  })
})

describe('README shot pixel inputs', () => {
  // Grok M114W P2: check:visual never renders the README scenes and the
  // budget test only sums bytes, so a token, stylesheet, or harness change
  // could silently stale the published PNGs. This fingerprint trips on any
  // change to those global pixel inputs; per-component drift stays with
  // check:visual's scene pixel gate. When it trips legitimately, recapture
  // with `npm run harness:shots` and refresh README_INPUTS_DIGEST below.
  // The digest hashes raw bytes; .gitattributes pins eol=lf, so it is
  // identical on Windows checkouts.
  const README_PIXEL_INPUTS = [
    'design/tokens/generated/host-roles.css',
    'design/tokens/muse.tokens.json',
    'scripts/lib/harnessServer.mjs',
    'scripts/readme-shots.json',
    'src/webview/bridges/theme/themeSurface.css',
    'src/webview/styles.css',
    'src/webview/tokens.css',
    'test/harness/index.html',
  ]
  const README_INPUTS_DIGEST = '1f018f7e02ccf9b6a40b5d3c870c12285008a717251fe9238244df02b18c8b13'

  it('fails when a pixel-determining input changes without a recapture', () => {
    expect(fingerprint(README_PIXEL_INPUTS)).toBe(README_INPUTS_DIGEST)
  })
})

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { SCENARIOS, withSizedPage } from '../../scripts/lib/harnessServer.mjs'
import {
  captureShot,
  checkCoverage,
  describeShot,
  parseArgs,
  parseShotList,
  readmeImageRefs,
  shotUrl,
} from '../../scripts/readme-shots.mjs'

vi.mock('../../scripts/lib/harnessServer.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  withSizedPage: vi.fn(),
}))

const list = parseShotList(readFileSync('scripts/readme-shots.json', 'utf8'))
const readme = readFileSync('README.md', 'utf8')
const harness = readFileSync('test/harness/index.html', 'utf8')
const captureDir = mkdtempSync(path.join(tmpdir(), 'readme-shot-test-'))
afterAll(() => rmSync(captureDir, { recursive: true, force: true }))

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

function pageFor(scan) {
  const waitFor = vi.fn()
  const screenshot = vi.fn()
  const page = {
    setViewportSize: vi.fn(),
    context: () => ({ newCDPSession: async () => ({ send: vi.fn() }) }),
    locator: () => ({ waitFor, textContent: async () => JSON.stringify(scan) }),
    screenshot,
  }
  vi.mocked(withSizedPage).mockImplementation(async (_chrome, _profile, _url, _sized, run) =>
    run(page),
  )
  return { page, waitFor, screenshot }
}

describe('readme capture readiness', () => {
  it('keeps the capture pending while the harness is not ready', async () => {
    const { waitFor, screenshot } = pageFor({ harnessErrors: [] })
    const readiness = Promise.withResolvers()
    waitFor.mockReturnValue(readiness.promise)
    const capture = captureShot('chrome', 1234, list.shots[0], captureDir, 'profile')
    await vi.waitFor(() => expect(waitFor).toHaveBeenCalled())
    expect(screenshot).not.toHaveBeenCalled()
    readiness.resolve()
    await capture
    expect(screenshot).toHaveBeenCalled()
  })

  it('captures the declared viewport after the harness scan settles', async () => {
    const { page, waitFor, screenshot } = pageFor({ harnessErrors: [] })
    const shot = { ...list.shots[0], width: 690, height: 760 }
    const file = await captureShot('chrome', 1234, shot, captureDir, 'profile')
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 690, height: 760 })
    expect(withSizedPage).toHaveBeenLastCalledWith(
      'chrome',
      'profile',
      `${shotUrl(1234, shot)}&axe=1`,
      { width: 690 },
      expect.any(Function),
    )
    expect(waitFor).toHaveBeenCalledWith({ state: 'attached' })
    expect(screenshot).toHaveBeenCalledWith({ path: file, animations: 'disabled' })
  })

  it.each([
    { error: 'scenario never became ready' },
    { harnessErrors: ['never rendered: .question'] },
  ])('refuses to write an image when the harness fails: %j', async (scan) => {
    const { screenshot } = pageFor(scan)
    await expect(captureShot('chrome', 1234, list.shots[0], captureDir, 'profile')).rejects.toThrow(
      /never/,
    )
    expect(screenshot).not.toHaveBeenCalled()
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

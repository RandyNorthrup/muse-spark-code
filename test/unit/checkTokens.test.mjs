import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TOKEN_SOURCE, renderTokens } from '../../scripts/build-tokens.mjs'
import { checkContrast, checkTokens, contrastRatio } from '../../scripts/check-tokens.mjs'

const fixtures = []
afterEach(async () => {
  for (const folder of fixtures.splice(0)) await rm(folder, { recursive: true, force: true })
})
const source = async () => JSON.parse(await readFile(TOKEN_SOURCE, 'utf8'))
const colour = (n, alpha = 1) => ({ colorSpace: 'srgb', components: [n, n, n], alpha })

async function fixture() {
  await mkdir('temp', { recursive: true })
  const root = await mkdtemp(path.resolve('temp/m114-tokens-'))
  fixtures.push(root)
  const input = await source()
  const outputs = { [TOKEN_SOURCE]: JSON.stringify(input), ...(await renderTokens(input)) }
  for (const [file, content] of Object.entries(outputs)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), content)
  }
  return root
}

describe('D94 check:tokens', () => {
  it('certifies all registered text and UI pairs in every palette', async () => {
    expect(checkContrast(await source())).toEqual([])
    expect(await checkTokens()).toEqual([])
  })

  it('fails a stale or missing output by name without rewriting it', async () => {
    const root = await fixture()
    const file = path.join(root, 'src/webview/tokens.css')
    await writeFile(file, '/* stale */')
    expect(await checkTokens(root)).toContain(
      'Stale token output: src/webview/tokens.css; run npm run build:tokens',
    )
    expect(await readFile(file, 'utf8')).toBe('/* stale */')
    await rm(file)
    expect(await checkTokens(root)).toContain(
      'Stale token output: src/webview/tokens.css; run npm run build:tokens',
    )
  })

  it('rejects a bad pair in just one mode, distinguishing text from UI thresholds', async () => {
    const input = await source()
    input.colour.text.$extensions['org.muse-spark-code'].modes.light = colour(1)
    expect(checkContrast(input)).toContain(
      'light: colour.text on colour.surface: 1.000:1 < 4.5:1 (text)',
    )
    const focus = await source()
    focus.colour.focus.$extensions['org.muse-spark-code'].modes.dark = colour(0)
    expect(checkContrast(focus).some((p) => p.includes('colour.focus') && p.endsWith('(ui)'))).toBe(
      true,
    )
  })

  it('checks emitted 8-bit colour values at the AA boundary, rather than unrounded inputs', async () => {
    const input = await source()
    input.colour.muted.$extensions['org.muse-spark-code'].modes.light = colour(0.4653)
    expect(contrastRatio(colour(0.4653), colour(1))).toBeGreaterThan(4.5)
    expect(
      checkContrast(input).some((p) => p.startsWith('light: colour.muted on colour.surface:')),
    ).toBe(true)
  })

  it('calculates linear-light WCAG luminance and alpha compositing before comparison', () => {
    expect(contrastRatio(colour(0), colour(1))).toBeCloseTo(21)
    expect(contrastRatio(colour(1), colour(0))).toBeCloseTo(21)
    expect(contrastRatio(colour(0.5), colour(1))).toBeCloseTo(3.97665)
    expect(contrastRatio(colour(0, 0.5), colour(1))).toBeCloseTo(3.97665)
    expect(contrastRatio(colour(0), colour(0, 0.5), colour(1))).toBeCloseTo(5.28082)
    expect(
      contrastRatio({ colorSpace: 'oklch', components: [0, 0, 0], alpha: 1 }, colour(1)),
    ).toBeCloseTo(21)
    expect(() => contrastRatio(colour(0), colour(1), colour(1, 0.5))).toThrow('must be opaque')
  })

  it('requires a contrast use or explicit decorative classification for every colour token', async () => {
    const input = await source()
    const meta = input.$extensions['org.muse-spark-code']
    meta.contrastPairs = meta.contrastPairs.filter((p) => p.foreground !== 'colour.progress')
    expect(() => checkContrast(input)).toThrow('Unpaired colour token: colour.progress')
    const invalid = await source()
    invalid.$extensions['org.muse-spark-code'].decorativeColours.push('colour.absent')
    expect(() => checkContrast(invalid)).toThrow('Unknown decorative colour')
  })

  it('fails invalid pair names, non-colours and alpha backgrounds without a named canvas', async () => {
    const input = await source()
    input.$extensions['org.muse-spark-code'].contrastPairs[0].foreground = 'radius.md'
    expect(() => checkContrast(input)).toThrow('requires a colour token')
    input.$extensions['org.muse-spark-code'].contrastPairs[0].foreground = 'colour.absent'
    expect(() => checkContrast(input)).toThrow('requires a colour token')
    input.$extensions['org.muse-spark-code'].contrastPairs[0].foreground = 'colour.text'
    input.$extensions['org.muse-spark-code'].contrastPairs[0].background = 'colour.shadow'
    expect(() => checkContrast(input)).toThrow('explicit canvas')
  })
})

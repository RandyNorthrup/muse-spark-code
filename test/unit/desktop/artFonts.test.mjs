// M111 AR art fonts: the image's text faces, the desktop fontconfig and the
// OFL notices. The font gate (`scripts/check-font-coverage.mjs`, shaped with
// HarfBuzz on desktop CI) proves coverage; this suite proves the choice the
// gate shapes is the approved one, the shipped fontconfig binds the role
// slots to those faces, and the notices name every face with its source
// package. The cert record carries the fc-list/fc-match run on linuxlt that
// proves fontconfig accepts the file (fontconfig is absent on Windows CI,
// so the acceptance run stays a drill).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { IMAGE_FONTS } from '../../../scripts/lib/fontCoverage.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CONF_PATH = path.join(ROOT, 'os', 'desktop', 'fontconfig', '59-muse-desktop.conf')
const NOTICES_PATH = path.join(ROOT, 'os', 'desktop', 'notices', 'fonts.md')

/** The generic slots the fontconfig defines; everything else it names must be an image font. */
const GENERIC_SLOTS = new Set(['sans-serif', 'serif', 'monospace'])

// Minimal element tree for the shipped fontconfig: comments, the doctype and
// processing instructions are dropped, text is trimmed, and mismatched tags
// throw, so a successful parse proves the file is well-formed XML.
function parseElements(xml) {
  const root = { name: '', attributes: {}, children: [], text: '' }
  const stack = [root]
  const tokenPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?[A-Za-z][^>]*>|[^<]+/g
  const tokens = xml.match(tokenPattern) ?? []
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!DOCTYPE')) {
      continue
    }
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim()
      const node = stack.pop()
      if (node?.name !== name) {
        throw new Error(`mismatched closing tag: expected </${node?.name}> but found ${token}`)
      }
      continue
    }
    if (token.startsWith('<')) {
      const selfClosing = token.endsWith('/>')
      const inner = token.slice(1, selfClosing ? -2 : -1).trim()
      const [name, ...rest] = inner.split(/\s+/)
      const pairs = rest
        .join(' ')
        .matchAll(/([A-Za-z]+)="([^"]*)"/g)
        .toArray()
      const attributes = Object.fromEntries(pairs.map(([, key, value]) => [key, value]))
      const node = { name, attributes, children: [], text: '' }
      stack.at(-1).children.push(node)
      if (!selfClosing) {
        stack.push(node)
      }
      continue
    }
    stack.at(-1).text += token.trim()
  }
  if (stack.length > 1) {
    throw new Error(
      `unclosed tags: ${stack
        .slice(1)
        .map((node) => node.name)
        .join(', ')}`,
    )
  }
  return root.children
}

function childrenOf(node, name) {
  return node.children.filter((child) => child.name === name)
}

function singleChild(node, name) {
  const matches = childrenOf(node, name)
  expect(matches, `<${node.name}> has exactly one <${name}>`).toHaveLength(1)
  return matches[0]
}

// Map each alias slot to its prefer family list. Aliases accumulate with the
// earlier file's list first, so these win by sorting at 59, after the
// person's 50-user.conf and 49-sansserif.conf and before 60-latin.conf.
function readSlotAliases(fontconfig) {
  return new Map(
    childrenOf(fontconfig, 'alias').map((alias) => [
      singleChild(alias, 'family').text,
      childrenOf(singleChild(alias, 'prefer'), 'family').map((family) => family.text),
    ]),
  )
}

// Map each font-match edit name to its { mode, values }.
function readRenderingMatch(fontconfig) {
  const rendering = childrenOf(fontconfig, 'match').filter(
    (match) => match.attributes.target === 'font',
  )
  expect(rendering, 'exactly one rendering match').toHaveLength(1)
  return new Map(
    childrenOf(rendering[0], 'edit').map((edit) => [
      edit.attributes.name,
      {
        mode: edit.attributes.mode,
        values: [...childrenOf(edit, 'bool'), ...childrenOf(edit, 'const')].map(
          (node) => node.text,
        ),
      },
    ]),
  )
}

async function readFontconfig() {
  const text = await readFile(CONF_PATH, 'utf8')
  expect(text).toContain('<!DOCTYPE fontconfig')
  const [fontconfig] = parseElements(text)
  expect(fontconfig?.name).toBe('fontconfig')
  return fontconfig
}

describe('image font set', () => {
  it('is the approved UI, code, CJK and emoji faces', () => {
    expect(IMAGE_FONTS).toEqual([
      { family: 'Inter', styles: ['Regular', 'Bold'], packages: 'fonts-inter' },
      {
        family: 'JetBrains Mono',
        styles: ['Regular', 'Bold'],
        packages: 'fonts-jetbrains-mono',
      },
      { family: 'Noto Sans CJK SC', styles: ['Regular', 'Bold'], packages: 'fonts-noto-cjk' },
      { family: 'Noto Sans CJK TC', styles: ['Regular', 'Bold'], packages: 'fonts-noto-cjk' },
      { family: 'Noto Sans CJK JP', styles: ['Regular', 'Bold'], packages: 'fonts-noto-cjk' },
      { family: 'Noto Sans CJK KR', styles: ['Regular', 'Bold'], packages: 'fonts-noto-cjk' },
      { family: 'Noto Color Emoji', styles: ['Regular'], packages: 'fonts-noto-color-emoji' },
    ])
  })
})

describe('desktop fontconfig', () => {
  it('sorts at 59, between the person and 60-latin', () => {
    expect(path.basename(CONF_PATH)).toBe('59-muse-desktop.conf')
  })

  it('prefers the UI face on the proportional slots', async () => {
    const fontconfig = await readFontconfig()
    const slots = readSlotAliases(fontconfig)
    expect(slots.get('sans-serif')).toEqual([
      'Inter',
      'Noto Sans CJK SC',
      'Noto Sans CJK TC',
      'Noto Sans CJK JP',
      'Noto Sans CJK KR',
      'Noto Color Emoji',
    ])
    // No serif face ships; serif renders in the UI face, never tofu.
    expect(slots.get('serif')).toEqual([
      'Inter',
      'Noto Sans CJK SC',
      'Noto Sans CJK TC',
      'Noto Sans CJK JP',
      'Noto Sans CJK KR',
    ])
  })

  it('prefers the code face on the monospace slot', async () => {
    const fontconfig = await readFontconfig()
    expect(readSlotAliases(fontconfig).get('monospace')).toEqual([
      'JetBrains Mono',
      'Noto Sans CJK SC',
      'Noto Sans CJK TC',
      'Noto Sans CJK JP',
      'Noto Sans CJK KR',
    ])
  })

  it('sets antialiasing, hinting and subpixel order without forcing a size', async () => {
    const fontconfig = await readFontconfig()
    const rendering = readRenderingMatch(fontconfig)
    expect(rendering.get('antialias')).toEqual({ mode: 'assign', values: ['true'] })
    expect(rendering.get('hinting')).toEqual({ mode: 'assign', values: ['true'] })
    expect(rendering.get('hintstyle')).toEqual({ mode: 'assign', values: ['hintfull'] })
    expect(rendering.get('rgba')).toEqual({ mode: 'assign', values: ['rgb'] })
    expect(rendering.get('lcdfilter')).toEqual({ mode: 'assign', values: ['lcddefault'] })
    expect(rendering.has('size'), 'no forced size').toBe(false)
    expect(rendering.has('dpi'), 'no forced dpi').toBe(false)
  })

  it('names only image fonts and the generic slots it defines', async () => {
    const fontconfig = await readFontconfig()
    const imageFamilies = new Set(IMAGE_FONTS.map((font) => font.family))
    // A pattern match here would hijack every request: 49-sansserif appends
    // a weak sans-serif to all of them, so any family test matches all.
    const patterns = childrenOf(fontconfig, 'match').filter(
      (match) => match.attributes.target === 'pattern',
    )
    expect(patterns, 'no pattern matches').toHaveLength(0)
    const slots = readSlotAliases(fontconfig)
    for (const [slot, preferred] of slots) {
      expect(GENERIC_SLOTS.has(slot), `unexpected slot ${slot}`).toBe(true)
      for (const family of preferred) {
        expect(imageFamilies.has(family), `${family} is not an image font`).toBe(true)
      }
    }
  })
})

describe('font notices', () => {
  it('names every image font with its source package and licence', async () => {
    const notices = await readFile(NOTICES_PATH, 'utf8')
    for (const { family, packages } of IMAGE_FONTS) {
      expect(notices).toContain(family)
      expect(notices).toContain(packages)
    }
    expect(notices).toMatch(/SIL\s+Open Font License/)
  })
})

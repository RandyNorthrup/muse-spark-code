// M111 lane AR: the icon theme is a valid freedesktop theme whose icons all
// render. Parses every committed index.theme, proves every committed SVG
// renders to real paint, proves the colours are the palette's (never
// invented, never stale), and proves the freshness check fires on a planted
// stale file (on a fixture, never the repo).
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { PNG } from 'pngjs'
import {
  ICON_CONTEXTS,
  ICON_OUTPUT,
  ICON_PALETTE,
  ICON_SOURCES,
  ICON_THEMES,
  iconPalette,
  renderIcons,
  renderIndexTheme,
  staleIcons,
  themeIcon,
  writeIcons,
} from '../../../scripts/build-icons.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const icons = JSON.parse(await readFile(path.join(root, ICON_PALETTE), 'utf8'))

const fixtures = []
afterEach(async () => {
  for (const folder of fixtures.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function sourceIcons() {
  const sources = new Map()
  for (const { dir } of ICON_CONTEXTS) {
    const files = await readdir(path.join(root, ICON_SOURCES, dir))
    for (const file of files) {
      if (!file.endsWith('.svg')) continue
      const name = file.slice(0, -'.svg'.length)
      sources.set(
        `${dir}/${name}`,
        await readFile(path.join(root, ICON_SOURCES, dir, file), 'utf8'),
      )
    }
  }
  return sources
}

function parseIndexTheme(text) {
  const sections = new Map()
  let current = null
  for (const line of text.split('\n')) {
    if (line === '') continue
    const section = /^\[(.*)\]$/.exec(line)
    if (section !== null) {
      current = new Map()
      sections.set(section[1], current)
      continue
    }
    const [key, value] = line.split('=', 2)
    current.set(key, value)
  }
  return sections
}

function paintColors(svg) {
  return svg
    .matchAll(/(?:fill|stroke)="([^"]+)"/g)
    .map((match) => match[1])
    .toArray()
}

function compareStrings(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function strokeWidths(svg) {
  return svg
    .matchAll(/stroke-width="([\d.]+)"/g)
    .map((match) => Number(match[1]))
    .toArray()
}

describe('icon sources', () => {
  it('cover the four contexts with valid freedesktop names', async () => {
    const sources = await sourceIcons()
    expect(sources.size).toBe(89)
    for (const name of sources.keys()) {
      expect(name).toMatch(/^(apps|status|places|mimetypes)\/[a-z0-9][a-z0-9-]*$/)
    }
    const contexts = new Set(sources.keys().map((name) => name.split('/', 1)[0]))
    expect(contexts.values().toArray().toSorted(compareStrings)).toEqual([
      'apps',
      'mimetypes',
      'places',
      'status',
    ])
  })

  it('carry placeholders and no literal colour', async () => {
    const sources = await sourceIcons()
    for (const [name, source] of sources) {
      expect(source, name).toContain('%%')
      expect(source, name).not.toMatch(/#[0-9a-f]{6}/i)
    }
  })

  it('reads the palette from TH, never invents one', () => {
    for (const theme of ICON_THEMES) {
      const palette = iconPalette(icons, theme.iconMode)
      for (const [key, value] of Object.entries(palette)) {
        expect(value).toBe(icons.modes[theme.iconMode][key].value)
      }
    }
    expect(() => iconPalette(icons, 'nope')).toThrowError(/no mode/)
    expect(() => iconPalette({ modes: { dark: {} } }, 'dark')).toThrowError(/not a #rrggbb/)
  })

  it('themes one icon: substitution, stroke scaling, loud failures', () => {
    const palette = iconPalette(icons, 'dark')
    const themed = themeIcon(
      '<svg><g fill="%%INFO%%" stroke-width="1.75"/></svg>',
      'x',
      palette,
      1.5,
    )
    expect(themed).toContain(`fill="${icons.modes.dark.info.value}"`)
    expect(themed).toContain('stroke-width="2.63"')
    expect(() => themeIcon('<svg/>', 'x', palette, 1)).toThrowError(/placeholder/)
    expect(() =>
      themeIcon('<svg fill="%%INFO%%"><rect fill="#ffffff"/></svg>', 'x', palette, 1),
    ).toThrowError(/literal colour/)
    expect(() => themeIcon('<svg>%%NOPE%%</svg>', 'x', palette, 1)).toThrowError(/placeholder/)
  })

  it('renders one index.theme exactly as the spec lays it out', () => {
    const text = renderIndexTheme(ICON_THEMES[0])
    expect(text).toContain('[Icon Theme]\nName=Muse\n')
    expect(text).toContain(
      'Directories=scalable/apps,scalable/status,scalable/places,scalable/mimetypes\n',
    )
    expect(text).toContain(
      '[scalable/status]\nSize=24\nMinSize=8\nMaxSize=512\nContext=Status\nType=Scalable\n',
    )
  })
})

// Two real icons through the real builder, the only fixture: fast enough
// for the suite, while `npm run check:art` proves the full tree.
async function miniOutputs() {
  const sources = new Map()
  for (const name of ['places/folder', 'status/dialog-error']) {
    const [context, icon] = name.split('/', 2)
    sources.set(name, await readFile(path.join(root, ICON_SOURCES, context, `${icon}.svg`), 'utf8'))
  }
  return renderIcons({ sources, icons })
}

describe('icon freshness', () => {
  it('writes every theme file, each icon under its context', async () => {
    const outputs = await miniOutputs()
    for (const theme of ICON_THEMES) {
      const base = `${ICON_OUTPUT}/${theme.dir}`
      expect(outputs.has(`${base}/index.theme`)).toBe(true)
      expect(outputs.has(`${base}/scalable/places/folder.svg`)).toBe(true)
      expect(outputs.has(`${base}/scalable/status/dialog-error.svg`)).toBe(true)
    }
  })

  it('finds a planted stale file and only that file', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'icons-'))
    fixtures.push(folder)
    const outputs = await miniOutputs()
    await writeIcons(folder, outputs)
    expect(await staleIcons(folder, outputs)).toEqual([])
    const victim = `${ICON_OUTPUT}/Muse/scalable/places/folder.svg`
    await writeFile(path.join(folder, victim), '<svg>stale</svg>')
    expect(await staleIcons(folder, outputs)).toEqual([victim])
  })
})

describe('committed icon themes', () => {
  it('parse as index.themes whose directories exist with valid sections', async () => {
    const sources = await sourceIcons()
    for (const theme of ICON_THEMES) {
      const base = `${ICON_OUTPUT}/${theme.dir}`
      const sections = parseIndexTheme(await readFile(path.join(root, base, 'index.theme'), 'utf8'))
      expect(sections.get('Icon Theme').get('Name')).toBe(theme.name)
      const directories = sections.get('Icon Theme').get('Directories').split(',')
      expect(directories).toEqual([
        'scalable/apps',
        'scalable/status',
        'scalable/places',
        'scalable/mimetypes',
      ])
      for (const directory of directories) {
        const section = sections.get(directory)
        expect(section.get('Size')).toBe('24')
        expect(section.get('Type')).toBe('Scalable')
        const files = await readdir(path.join(root, base, directory))
        expect(files.length).toBeGreaterThan(0)
        for (const file of files) {
          expect(file.endsWith('.svg')).toBe(true)
        }
      }
      const example = sections.get('Icon Theme').get('Example')
      const found = []
      for (const directory of directories) {
        const files = await readdir(path.join(root, base, directory))
        if (files.includes(`${example}.svg`)) found.push(directory)
      }
      expect(found.length).toBeGreaterThan(0)
      for (const name of sources.keys()) {
        const [context, icon] = name.split('/', 2)
        const files = await readdir(path.join(root, base, 'scalable', context))
        expect(files, `${theme.dir} lacks ${name}`).toContain(`${icon}.svg`)
      }
    }
  })

  it('paints only the mode palette, with HC strokes scaled', async () => {
    const sources = await sourceIcons()
    for (const theme of ICON_THEMES) {
      const palette = new Set(Object.values(iconPalette(icons, theme.iconMode)))
      for (const name of sources.keys()) {
        const [context, icon] = name.split('/', 2)
        const svg = await readFile(
          path.join(root, ICON_OUTPUT, theme.dir, 'scalable', context, `${icon}.svg`),
          'utf8',
        )
        expect(svg, `${theme.dir}/${name}`).not.toContain('%%')
        for (const color of paintColors(svg)) {
          const isAllowed = color === 'none' || palette.has(color)
          expect(isAllowed, `${theme.dir}/${name} paints ${color}`).toBe(true)
        }
        const sourceWidths = strokeWidths(sources.get(name))
        const themedWidths = strokeWidths(svg)
        expect(themedWidths).toHaveLength(sourceWidths.length)
        for (const [index, width] of themedWidths.entries()) {
          expect(width).toBeCloseTo(sourceWidths[index] * theme.strokeScale, 2)
        }
      }
    }
  })
})

async function paintedPixels(svg, theme, name) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 48 },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng()
  const { data } = PNG.sync.read(Buffer.from(png))
  let painted = 0
  for (let pixel = 3; pixel < data.length; pixel += 4) {
    if (data[pixel] > 31) painted += 1
  }
  // Hundreds on every real icon; an empty canvas paints none.
  expect(painted, `${theme.dir}/${name} paints nothing`).toBeGreaterThan(40)
}

// Twelve icons a test: a whole context's renders take longer than the
// repository's 5 s test budget on a busy rig.
const renderChunks = []
{
  const sources = await sourceIcons()
  for (const theme of ICON_THEMES) {
    for (const { dir } of ICON_CONTEXTS) {
      const names = sources
        .keys()
        .filter((name) => name.startsWith(`${dir}/`))
        .toArray()
      let part = 0
      for (let at = 0; at < names.length; at += 12) {
        part += 1
        renderChunks.push({ theme, dir, part, names: names.slice(at, at + 12) })
      }
    }
  }
}

for (const theme of ICON_THEMES) {
  describe(`committed ${theme.dir} icons render`, () => {
    const chunks = renderChunks.filter((entry) => entry.theme === theme)
    for (const chunk of chunks) {
      it(`${chunk.dir} paints real pixels at 48px, part ${String(chunk.part)}`, async () => {
        for (const name of chunk.names) {
          const icon = name.slice(chunk.dir.length + 1)
          const svg = await readFile(
            path.join(root, ICON_OUTPUT, theme.dir, 'scalable', chunk.dir, `${icon}.svg`),
            'utf8',
          )
          await paintedPixels(svg, theme, name)
        }
      })
    }
  })
}

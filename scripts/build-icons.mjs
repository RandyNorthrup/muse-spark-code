// M111 lane AR (D91.11): the icon theme, built from the SVG sources in
// design/art/icons/src/ and TH's icon palette
// (desktop/shell/theme/icons.json). One source set in the mockups' stroke
// language, four themes (one per appearance mode): Muse (dark),
// Muse-Light, Muse-HC-Dark and Muse-HC-Light (strokes x1.5). SVG-only is
// valid per the freedesktop icon-theme specification (Type=Scalable);
// contexts are apps, status, places and mimetypes.
//
//   node scripts/build-icons.mjs          regenerate every themed icon
//   node scripts/build-icons.mjs --check  exit 1 naming stale files
//
// Design record: docs/certification/rlf-m111ar.md.
import { Buffer } from 'node:buffer'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { isEntryPoint } from './lib/entryPoint.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

export const ICON_SOURCES = 'design/art/icons/src'
export const ICON_OUTPUT = 'design/art/icons'
export const ICON_PALETTE = 'desktop/shell/theme/icons.json'
export const ICON_CONTEXTS = [
  { dir: 'apps', context: 'Applications' },
  { dir: 'status', context: 'Status' },
  { dir: 'places', context: 'Places' },
  { dir: 'mimetypes', context: 'MimeTypes' },
]
export const ICON_THEMES = [
  {
    dir: 'Muse',
    name: 'Muse',
    iconMode: 'dark',
    strokeScale: 1,
    comment: 'Muse Desktop: the icon theme, dark (D91.11).',
  },
  {
    dir: 'Muse-Light',
    name: 'Muse-Light',
    iconMode: 'light',
    strokeScale: 1,
    comment: 'Muse Desktop: the icon theme, light (D91.11).',
  },
  {
    dir: 'Muse-HC-Dark',
    name: 'Muse-HC-Dark',
    iconMode: 'hc-dark',
    strokeScale: 1.5,
    comment: 'Muse Desktop: the icon theme, high contrast on dark (D91.11).',
  },
  {
    dir: 'Muse-HC-Light',
    name: 'Muse-HC-Light',
    iconMode: 'hc-light',
    strokeScale: 1.5,
    comment: 'Muse Desktop: the icon theme, high contrast on light (D91.11).',
  },
]
const ICON_NAME = /^[a-z0-9][a-z0-9-]*$/
const STROKE_WIDTH = /stroke-width="(\d+(?:\.\d+)?)"/g
const PLACEHOLDERS = ['FOREGROUND', 'MUTED', 'ACCENT', 'SUCCESS', 'WARNING', 'DANGER', 'INFO']

function fail(message) {
  throw new Error(`build-icons: ${message}`)
}

/** The theme palette from TH's icons.json, validated; no colour is invented here. */
export function iconPalette(icons, mode) {
  const entry = icons?.modes?.[mode]
  if (entry === undefined) fail(`icons.json has no mode ${mode}`)
  const palette = {}
  for (const key of ['foreground', 'muted', 'accent', 'success', 'warning', 'danger', 'info']) {
    const value = entry[key]?.value
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/.test(value)) {
      fail(`icons.json ${mode} ${key} is not a #rrggbb colour`)
    }
    palette[key] = value
  }
  return palette
}

/**
A source SVG themed for one output: placeholders become the palette, every
stroke-width scales. Sources carry no hex colour, so a leftover placeholder
or a literal fails loudly instead of shipping.
*/
export function themeIcon(source, icon, palette, strokeScale) {
  if (!source.includes('%%')) fail(`${icon}: expected at least one palette placeholder`)
  if (/#[0-9a-f]{6}/i.test(source)) fail(`${icon}: a literal colour slipped into a source`)
  let themed = source
  for (const key of PLACEHOLDERS) {
    themed = themed.replaceAll(`%%${key}%%`, () => palette[key.toLowerCase()])
  }
  themed = themed.replaceAll(STROKE_WIDTH, (_, width) => {
    const scaled = Number(width) * strokeScale
    return `stroke-width="${String(Math.round(scaled * 100) / 100)}"`
  })
  if (themed.includes('%%')) fail(`${icon}: an unknown placeholder survived theming`)
  return themed
}

export function renderIndexTheme(theme) {
  const directories = ICON_CONTEXTS.map(({ dir }) => `scalable/${dir}`)
  const lines = [
    '[Icon Theme]',
    `Name=${theme.name}`,
    `Comment=${theme.comment}`,
    'Inherits=hicolor',
    `Directories=${directories.join(',')}`,
    'Example=folder',
    '',
  ]
  for (const { dir, context } of ICON_CONTEXTS) {
    lines.push(
      `[scalable/${dir}]`,
      'Size=24',
      'MinSize=8',
      'MaxSize=512',
      `Context=${context}`,
      'Type=Scalable',
      '',
    )
  }
  return lines.join('\n')
}

/**
Every theme file in memory: `sources` maps `context/name` to its raw SVG,
`icons` is the parsed icons.json. Keys are repo-relative posix paths.
*/
export function renderIcons({ sources, icons }) {
  const outputs = new Map()
  for (const theme of ICON_THEMES) {
    const palette = iconPalette(icons, theme.iconMode)
    const base = `${ICON_OUTPUT}/${theme.dir}`
    outputs.set(`${base}/index.theme`, renderIndexTheme(theme))
    const names = sources.keys().toArray().toSorted(compareStrings)
    for (const name of names) {
      const [context, icon] = name.split('/', 2)
      outputs.set(
        `${base}/scalable/${context}/${icon}.svg`,
        themeIcon(sources.get(name), name, palette, theme.strokeScale),
      )
    }
  }
  return outputs
}

function compareStrings(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function toPosix(relative) {
  return relative.split(path.sep).join(path.posix.sep)
}

async function readInputs(root) {
  const icons = JSON.parse(await readFile(path.join(root, ICON_PALETTE), 'utf8'))
  const sources = new Map()
  for (const { dir } of ICON_CONTEXTS) {
    const folder = path.join(root, ICON_SOURCES, dir)
    let files
    try {
      files = await readdir(folder)
    } catch (error) {
      // NARROW: a missing context is a broken source tree, said plainly.
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error
      fail(`no sources in ${ICON_SOURCES}/${dir}`)
    }
    for (const file of files.toSorted(compareStrings)) {
      if (file.startsWith('.')) continue
      if (!file.endsWith('.svg')) fail(`${dir}/${file} is not an icon source`)
      const name = file.slice(0, -'.svg'.length)
      if (!ICON_NAME.test(name)) fail(`${dir}/${file} is not a freedesktop icon name`)
      sources.set(`${dir}/${name}`, await readFile(path.join(folder, file), 'utf8'))
    }
  }
  if (sources.size === 0) fail('no icon sources at all')
  return { sources, icons }
}

export async function writeIcons(root, outputs) {
  for (const [name, data] of outputs) {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
  }
}

/** Repo-relative posix paths whose committed bytes differ from a fresh render. */
export async function staleIcons(root, outputs) {
  const stale = []
  for (const [name, data] of outputs) {
    let committed
    try {
      committed = await readFile(path.join(root, name))
    } catch (error) {
      // NARROW: only a missing output counts as stale; anything else is real.
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error
      stale.push(name)
      continue
    }
    if (!committed.equals(Buffer.from(data, 'utf8'))) stale.push(name)
  }
  return stale.toSorted(compareStrings).map((name) => toPosix(name))
}

async function main() {
  const check = process.argv.includes('--check')
  const inputs = await readInputs(REPO_ROOT)
  const outputs = renderIcons(inputs)
  if (!check) {
    await writeIcons(REPO_ROOT, outputs)
    process.stdout.write(`icons: wrote ${String(outputs.size)} files\n`)
    return
  }
  const stale = await staleIcons(REPO_ROOT, outputs)
  if (stale.length > 0) {
    process.stdout.write(`icons: stale output:\n${stale.map((name) => `  ${name}\n`).join('')}`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`icons: ${String(outputs.size)} outputs fresh\n`)
}

if (isEntryPoint(import.meta.url)) {
  await main()
}

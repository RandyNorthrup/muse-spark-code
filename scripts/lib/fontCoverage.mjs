// Muse Desktop (M111, D91.20) lane IN: the font-coverage gate. Shapes every
// codepoint of every UI string with HarfBuzz (`hb-shape`, from the
// image's `libharfbuzz-bin`) against every image font and fails a codepoint
// no image font covers, naming the codepoint and the string that carries
// it. Coverage is the union across the image's fonts, as fontconfig's
// fallback renders it: Latin comes from the UI face, CJK from the CJK
// faces, emoji from the emoji face. Font files resolve through fontconfig
// from the families below, whose Debian packages live in
// os/desktop/packages.conf (lane IM wires that file into the desktop
// profile).
//
// One HarfBuzz run shapes the whole codepoint list per font, with a space
// between codepoints so no two interact (an unseparated run composes a
// mark into its neighbour and merges their clusters, which would report
// covered glyphs as missing). Combining marks shape one per run instead:
// a mark after any base takes its cluster, so only isolation keeps the
// mark's own cluster readable.
//
// A Linux gate for desktop CI and local runs: without fontconfig,
// hb-shape or the image's fonts it fails closed (exit 2), naming what is
// missing. It is not in `quality:gates`: hosted Windows and macOS runners
// carry neither hb-shape nor these fonts.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { flattenTable } from '../../desktop/crates/l10n/tools/tables.mjs'
import { loadL10n } from './l10nSource.mjs'

export const OS_DESKTOP_PACKAGES = 'os/desktop/packages.conf'
export const ENGLISH_LOCALE = 'en'

/**
The image's text faces: the UI face and the monospace face in Regular and
Bold, each CJK face in Regular and Bold (separate faces of one TTC, told
apart by fontconfig's index), and the emoji face. Lane AR may refine the
UI and monospace families; until it does, Noto Sans and Noto Sans Mono
stand in.
*/
export const IMAGE_FONTS = [
  { family: 'Noto Sans', styles: ['Regular', 'Bold'], packages: 'fonts-noto-core' },
  { family: 'Noto Sans Mono', styles: ['Regular', 'Bold'], packages: 'fonts-noto-core' },
  { family: 'Noto Sans CJK SC', styles: ['Regular', 'Bold'], packages: 'fonts-noto-cjk' },
  { family: 'Noto Sans CJK TC', styles: ['Regular', 'Bold'], packages: 'fonts-noto-cjk' },
  { family: 'Noto Sans CJK JP', styles: ['Regular', 'Bold'], packages: 'fonts-noto-cjk' },
  { family: 'Noto Sans CJK KR', styles: ['Regular', 'Bold'], packages: 'fonts-noto-cjk' },
  { family: 'Noto Color Emoji', styles: ['Regular'], packages: 'fonts-noto-color-emoji' },
]

// Shaping skips controls, formats, surrogates, unassigned codepoints and
// the line/paragraph separators: none of them has a glyph to miss. Private
// use stays shaped: a symbol-font character with no image glyph must fail.
const UNSHAPED = /[\p{Cc}\p{Cf}\p{Cs}\p{Cn}\u{2028}\u{2029}]/u

function hex(codepoint) {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
Every shaped codepoint of the fifteen UI tables, each with the first
(locale, key) that carries it for the failure message. English comes from
the compiled source, the translations from their JSON files.
*/
export function collectCodepoints(locales, flattened) {
  const found = new Map()
  for (const locale of locales) {
    const pairs = flattened[locale]
    for (const [key, text] of pairs) {
      for (const char of text) {
        const codepoint = char.codePointAt(0)
        if (!UNSHAPED.test(char) && !found.has(codepoint)) {
          found.set(codepoint, { codepoint, locale, key })
        }
      }
    }
  }
  return found
    .values()
    .toArray()
    .toSorted((left, right) => left.codepoint - right.codepoint)
}

/** Loads the fifteen UI tables flattened to [key, text] pairs. */
export async function loadUiStrings(repoRoot) {
  if (!existsSync(path.join(repoRoot, 'src/shared/l10n/en.ts'))) {
    throw new Error('src/shared/l10n is missing')
  }
  const { EN, TABLE_DIRECTORY, TABLE_LOCALES, isPluralForms, tableFileName } =
    await loadL10n(repoRoot)
  const locales = [ENGLISH_LOCALE, ...TABLE_LOCALES]
  const flattened = { [ENGLISH_LOCALE]: flattenTable(EN, isPluralForms) }
  for (const locale of TABLE_LOCALES) {
    const file = path.join(repoRoot, TABLE_DIRECTORY, tableFileName(locale))
    if (!existsSync(file)) {
      throw new Error(`${TABLE_DIRECTORY}/${tableFileName(locale)} is missing`)
    }
    flattened[locale] = flattenTable(JSON.parse(readFileSync(file, 'utf8')), isPluralForms)
  }
  return { locales, flattened }
}

function runCommand(command, args) {
  try {
    // HarfBuzz answers one JSON record per codepoint; sixteen megabytes
    // holds twenty times the current tables.
    return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `${command} is missing (desktop CI installs ${command === 'hb-shape' ? 'libharfbuzz-bin' : 'fontconfig'})`,
        { cause: error },
      )
    }
    throw new Error(`${command} failed (exit ${String(error.status ?? 'unknown')})`, {
      cause: error,
    })
  }
}

/**
Resolves one family and style to its file and TTC face index. fontconfig
answers a fallback when the family is absent, so the match's own family
and style must equal the request, or the font counts as missing.
*/
export function resolveFontFile(family, style) {
  const [file, index, matchedFamily, matchedStyle] = runCommand('fc-match', [
    `${family}:style=${style}`,
    String.raw`--format=%{file}\n%{index}\n%{family}\n%{style}\n`,
  ])
    .split('\n')
    .map((line) => line.trim())
  if (matchedStyle !== style || matchedFamily?.toLowerCase() !== family.toLowerCase()) {
    throw new Error(
      `${family} ${style} resolves to ${matchedFamily ?? '(nothing)'} ${matchedStyle ?? ''}; install the image fonts`,
    )
  }
  return { file, index: Number(index) }
}

/**
Shapes codepoints with HarfBuzz, one run per font. A space separates
codepoints so none interact; codepoint `i` of the input owns cluster `2i`.
Returns the glyph records of the JSON output.
*/
export function shapeCodepoints(fontFile, faceIndex, codepoints) {
  const unicodes = codepoints
    .flatMap((codepoint) => [`U+${codepoint.toString(16).toUpperCase()}`, 'U+0020'])
    .slice(0, -1)
    .join(',')
  const output = runCommand('hb-shape', [
    fontFile,
    `--face-index=${String(faceIndex)}`,
    `--unicodes=${unicodes}`,
    '--output-format=json',
    '--no-glyph-names',
  ])
  const records = JSON.parse(output)
  if (!Array.isArray(records)) throw new TypeError(`hb-shape answered ${output.slice(0, 80)}`)
  return records
}

/**
The input indexes HarfBuzz could not shape: glyph id 0 (.notdef) at their
cluster, or a cluster the output never mentions.
*/
export function missingCodepoints(records, count) {
  const covered = new Set()
  for (const record of records) {
    if (typeof record?.g === 'number' && record.g !== 0 && typeof record?.cl === 'number') {
      covered.add(record.cl)
    }
  }
  return Array.from({ length: count }, (_, index) => index).filter(
    (index) => !covered.has(index * 2),
  )
}

const MARK = /\p{M}/u

/**
Shapes every string against every image font; a problem names a codepoint
no image font covers and the string that carries it.
*/
export async function checkFontCoverage(repoRoot) {
  const problems = []
  const { locales, flattened } = await loadUiStrings(repoRoot)
  const shaped = collectCodepoints(locales, flattened)
  // One batch run for everything but marks, then one isolated run per
  // mark; each run maps its positions back onto the shaped list.
  const runs = [
    {
      codepoints: [],
      indexes: [],
    },
  ]
  for (const [at, entry] of shaped.entries()) {
    if (MARK.test(String.fromCodePoint(entry.codepoint))) {
      runs.push({ codepoints: [entry.codepoint], indexes: [at] })
    } else {
      runs[0].codepoints.push(entry.codepoint)
      runs[0].indexes.push(at)
    }
  }
  const covered = new Set()
  let fonts = 0
  for (const { family, styles } of IMAGE_FONTS) {
    for (const style of styles) {
      const { file, index } = resolveFontFile(family, style)
      fonts += 1
      for (const run of runs) {
        const records = shapeCodepoints(file, index, run.codepoints)
        const missing = new Set(missingCodepoints(records, run.codepoints.length))
        for (const [at, index] of run.indexes.entries()) {
          if (missing.has(at)) continue
          covered.add(index)
        }
      }
    }
  }
  for (const [at, entry] of shaped.entries()) {
    if (covered.has(at)) continue
    problems.push(
      `${hex(entry.codepoint)} (${entry.locale} ${entry.key}) has no glyph in any image font`,
    )
  }
  return {
    code: problems.length > 0 ? 1 : 0,
    output: `${[...problems, `font coverage: ${String(fonts)} fonts, ${String(shaped.length)} codepoints; ${String(problems.length)} problems`].join('\n')}\n`,
  }
}

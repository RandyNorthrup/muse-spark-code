// Refreshes the README's screenshots from the UI harness
// (test/harness/index.html), one scenario per image as declared in
// scripts/readme-shots.json. Each scenario opens like harness-shots does —
// served from the repository, played under a fast-forwarded clock so the
// shot waits for it to settle — and is captured at the entry's size.
// Needs a Chrome install and a dev bundle (`npm run build:dev`).
//
// Run it as `node scripts/readme-shots.mjs` (`npm run readme:shots`): the
// file is imported by test/unit/readmeShots.test.mjs, so like the other
// script libraries it has no shebang.
//
//   node scripts/readme-shots.mjs                  every entry → media/readme/
//   node scripts/readme-shots.mjs --only turn,agents   just those images
//   node scripts/readme-shots.mjs --out temp/readme-preview   preview elsewhere
//   node scripts/readme-shots.mjs --list           the mapping and its gaps
//   CHROME_PATH=/path/to/chrome node scripts/readme-shots.mjs

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { findChrome } from './lib/chrome.mjs'
import { screenshotUrl } from './lib/harnessCapture.mjs'
import { langQuery, prepareLang } from './lib/harnessLang.mjs'
import { HARNESS_PATH, LOOPBACK, SCENARIOS, serveRepo } from './lib/harnessServer.mjs'

export const SHOT_LIST_FILE = 'scripts/readme-shots.json'
export const README_FILE = 'README.md'
export const DEFAULT_OUT_DIR = 'media/readme'
export const BUNDLE_PATH = 'dist/webview/main.js'
export const THEMES = new Set(['dark', 'light', 'hc-dark', 'hc-light'])
// Chrome's headless CLI clamps windows below this width (see
// withSizedPage in scripts/lib/harnessServer.mjs): a narrower shot has no
// capture path here yet.
export const MIN_CLI_WIDTH = 500
const LANG_ID = /^[a-z]{2,3}(?:-[a-z\d]+)*$/
const SHOT_IMAGE = /^media\/readme\/[^/]+\.png$/
const README_IMAGE = /media\/readme\/[A-Za-z0-9][\w.-]*\.png/g
const repoRoot = process.cwd()

function fail(what, reason) {
  throw new Error(`${SHOT_LIST_FILE}: ${what} ${reason}`)
}

function checkShot(shot, index) {
  const what = `shots[${String(index)}]`
  if (typeof shot !== 'object' || shot === null) {
    fail(what, 'is not an object')
  }
  const { file, scenario, theme, width, height, lang, note } = shot
  if (typeof file !== 'string' || !SHOT_IMAGE.test(file)) {
    fail(what, 'needs a file like "media/readme/<name>.png"')
  }
  if (typeof scenario !== 'string' || !SCENARIOS.includes(scenario)) {
    fail(what, `names an unknown harness scenario: ${String(scenario)}`)
  }
  if (typeof theme !== 'string' || !THEMES.has(theme)) {
    fail(what, `needs a theme of ${[...THEMES].join('|')}: ${String(theme)}`)
  }
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    fail(what, 'needs a positive integer width and height')
  }
  if (lang !== undefined && (typeof lang !== 'string' || !LANG_ID.test(lang))) {
    fail(what, `needs a VS Code language id for lang: ${String(lang)}`)
  }
  if (typeof note !== 'string' || note.trim() === '') {
    fail(what, 'needs a note saying what the README caption shows')
  }
  return { file, scenario, theme, width, height, lang, note }
}

/** Parses and validates the shot list: `{ shots, excluded }`. */
export function parseShotList(text) {
  let list
  try {
    list = JSON.parse(text)
  } catch {
    fail('list', 'is not valid JSON')
  }
  if (typeof list !== 'object' || list === null || !Array.isArray(list.shots)) {
    fail('list', 'needs a "shots" array')
  }
  const shots = list.shots.map((shot, index) => checkShot(shot, index))
  const seen = new Set()
  for (const shot of shots) {
    if (seen.has(shot.file)) {
      fail('list', `names ${shot.file} twice`)
    }
    seen.add(shot.file)
  }
  const excluded = list.excluded ?? []
  if (!Array.isArray(excluded)) {
    fail('list', 'needs "excluded" as an array when present')
  }
  for (const [index, entry] of excluded.entries()) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.file !== 'string' ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim() === ''
    ) {
      fail(`excluded[${String(index)}]`, 'needs a file and a reason')
    }
  }
  return { shots, excluded }
}

function parseOnly(value) {
  const names = value
    .split(',')
    .map((name) => name.trim().replace(/\.png$/, ''))
    .filter((name) => name !== '')
  if (names.length === 0) {
    throw new Error('--only needs at least one image name')
  }
  return names
}

/** CLI arguments: `{ only, out, list }`. */
export function parseArgs(argv) {
  let only = null
  let out = DEFAULT_OUT_DIR
  let isList = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--list') {
      isList = true
    } else if (arg === '--only' || arg.startsWith('--only=')) {
      const value = arg === '--only' ? next : arg.slice('--only='.length)
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--only needs a value: --only <name,...>')
      }
      only = parseOnly(value)
      if (arg === '--only') {
        index += 1
      }
    } else if (arg === '--out' || arg.startsWith('--out=')) {
      const value = arg === '--out' ? next : arg.slice('--out='.length)
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new Error('--out needs a directory: --out <dir>')
      }
      out = value
      if (arg === '--out') {
        index += 1
      }
    } else {
      throw new Error(
        `Unknown argument ${arg}; the flags are --list, --only <name,...> and --out <dir>`,
      )
    }
  }
  return { only, out, list: isList }
}

const compareNames = (a, b) => a.localeCompare(b, 'en')

/** Every `media/readme/*.png` reference in the README, sorted and unique. */
export function readmeImageRefs(readme) {
  return [...new Set(Array.from(readme.matchAll(README_IMAGE), (match) => match[0]))].toSorted(
    compareNames,
  )
}

/**
 * Coverage of the README's images by the list: `{ missingEntries, unreferenced }`.
 * `missingEntries` are README images with neither a shot nor an exclusion;
 * `unreferenced` are listed files the README never shows.
 */
export function checkCoverage({ shots, excluded }, refs) {
  const listed = new Set([
    ...shots.map((shot) => shot.file),
    ...excluded.map((entry) => entry.file),
  ])
  return {
    missingEntries: refs.filter((ref) => !listed.has(ref)),
    unreferenced: [...listed].filter((file) => !refs.includes(file)).toSorted(compareNames),
  }
}

/** The harness URL a shot captures. */
export function shotUrl(port, shot) {
  return `http://${LOOPBACK}:${String(port)}/${HARNESS_PATH}?scenario=${shot.scenario}&theme=${shot.theme}${langQuery(shot.lang)}`
}

/** One mapping row for --list. */
export function describeShot(shot) {
  const size = `${String(shot.width)}x${String(shot.height)}`
  const lang = shot.lang === undefined ? '' : ` lang=${shot.lang}`
  return `${shot.file} <- ${shot.scenario} theme=${shot.theme} ${size}${lang} — ${shot.note}`
}

async function captureShot(chrome, port, shot, outDir, profileDir) {
  if (shot.width < MIN_CLI_WIDTH) {
    throw new Error(
      `${shot.file} is ${String(shot.width)} px wide: headless Chrome clamps below ${String(MIN_CLI_WIDTH)} px and a narrow capture path does not exist yet`,
    )
  }
  const file = path.join(outDir, path.basename(shot.file))
  await mkdir(path.dirname(file), { recursive: true })
  await screenshotUrl(chrome, shotUrl(port, shot), file, {
    width: shot.width,
    height: shot.height,
    profileDir,
  })
  return file
}

async function listShots(list) {
  const refs = readmeImageRefs(await readFile(path.join(repoRoot, README_FILE), 'utf8'))
  for (const shot of list.shots) {
    console.log(describeShot(shot))
  }
  for (const entry of list.excluded) {
    console.log(`${entry.file} excluded: ${entry.reason}`)
  }
  const { missingEntries, unreferenced } = checkCoverage(list, refs)
  for (const ref of missingEntries) {
    console.log(`no entry: the README shows ${ref} but the list names no shot for it`)
  }
  for (const file of unreferenced) {
    console.log(`not shown: the list names ${file} but the README never shows it`)
  }
  if (missingEntries.length > 0 || unreferenced.length > 0) {
    process.exitCode = 1
  }
}

async function shootShots(list, { only, out }) {
  if (!existsSync(path.join(repoRoot, BUNDLE_PATH))) {
    throw new Error(`${BUNDLE_PATH} is missing; run \`npm run build:dev\` first`)
  }
  const chrome = findChrome()
  if (chrome === undefined) {
    throw new Error('No Chrome install found; set CHROME_PATH to the browser executable')
  }
  const shots =
    only === null
      ? list.shots
      : list.shots.filter((shot) => only.includes(path.basename(shot.file, '.png')))
  const known = new Set(list.shots.map((shot) => path.basename(shot.file, '.png')))
  const unknown = (only ?? []).filter((name) => !known.has(name))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown image(s): ${unknown.join(', ')}. Known: ${[...known].toSorted(compareNames).join(', ')}`,
    )
  }
  const langs = new Set(shots.map((shot) => shot.lang))
  for (const lang of langs) {
    if (lang !== undefined) {
      await prepareLang(repoRoot, lang)
    }
  }
  const outDir = path.resolve(repoRoot, out)
  const profileDir = await mkdtemp(path.join(tmpdir(), 'muse-readme-'))
  const { server, port } = await serveRepo(repoRoot)
  try {
    for (const shot of shots) {
      const file = await captureShot(chrome, port, shot, outDir, profileDir)
      console.log(`${shot.scenario}: ${path.relative(repoRoot, file)}`)
    }
  } finally {
    server.close()
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

async function main() {
  const list = parseShotList(await readFile(path.join(repoRoot, SHOT_LIST_FILE), 'utf8'))
  const args = parseArgs(process.argv.slice(2))
  if (args.list) {
    await listShots(list)
    return
  }
  await shootShots(list, args)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main()
}

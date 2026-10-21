import { mkdtempSync, readFileSync, rmSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { packRuntimeArchive } from '../../scripts/lib/packageArchive.mjs'
import { UI_TEXT_REGIONS } from '../../scripts/lib/uiTextRegions.mjs'
import { loadL10n } from '../../scripts/lib/l10nSource.mjs'
import { readArchivedUiTable } from '../../src/shared/l10n/tableArchive'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'

// Packing the real UI tables must reproduce the real locale files byte for
// byte once decoded: the package-time gate compares JSON.stringify(shipped)
// with JSON.stringify(source), so any order drift (TOOLROUNDS round 5 broke
// `npm pack` this way) fails here without running a pack. The region modules
// carry the full canonical EN: only the values matrix is asserted, and the
// regions exist so the archiver reads them exactly as in production.
const root = process.cwd()
const stage = { dir: '', archive: '' }
// Packing the real tables at production brotli quality took 7.1 s on macbook;
// hosted runners with coverage need headroom past the 10 s hook default.
const PACK_SETUP_TIMEOUT_MS = 30_000

// The first dotted path where the decoded table differs from its source, in
// key order or value, so a failure names one line instead of two whole tables.
function divergence(shipped, source, prefix = '') {
  const areBothRecords =
    typeof shipped === 'object' && shipped !== null && typeof source === 'object' && source !== null
  if (!areBothRecords)
    return JSON.stringify(shipped) === JSON.stringify(source) ? null : prefix || '<top>'
  const shippedKeys = Object.keys(shipped)
  const sourceKeys = Object.keys(source)
  const where = prefix || '<top>'
  if (shippedKeys.length !== sourceKeys.length)
    return `${where}: ${String(shippedKeys.length)} keys shipped, ${String(sourceKeys.length)} in source`
  const at = shippedKeys.findIndex((key, index) => sourceKeys[index] !== key)
  if (at !== -1)
    return `${where}: shipped "${shippedKeys[at] ?? ''}" where the source has "${sourceKeys[at] ?? ''}"`
  for (const key of shippedKeys) {
    const here = prefix === '' ? key : `${prefix}.${key}`
    const found = divergence(shipped[key], source[key], here)
    if (found !== null) return found
  }
  return null
}

beforeAll(async () => {
  stage.dir = mkdtempSync(path.join(tmpdir(), 'l10n-pack-parity-'))
  const fixture = path.join(stage.dir, 'root')
  mkdirSync(path.join(fixture, 'dist'), { recursive: true })
  const english = JSON.stringify(EN)
  for (const region of UI_TEXT_REGIONS)
    writeFileSync(path.join(fixture, region.output), `exports.EN=${english};\n`)
  cpSync(path.join(root, 'l10n'), path.join(fixture, 'l10n'), { recursive: true })
  mkdirSync(path.join(stage.dir, 'stage', 'dist'), { recursive: true })
  writeFileSync(path.join(stage.dir, 'stage', 'dist', 'uiText.js'), 'exports.EN={};\n')
  const tables = TABLE_LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(path.join(root, 'l10n', `ui.${locale}.json`), 'utf8')),
  ])
  // Decoded tables are quality-invariant; quality 1 packs in ~1 s instead
  // of ~20 s at the production quality, inside the hook's 30 s budget.
  await packRuntimeArchive(fixture, path.join(stage.dir, 'stage'), [], tables, 1)
  const l10n = await loadL10n(root)
  const archiveFile = path.join(
    stage.dir,
    'stage',
    l10n.TABLE_DIRECTORY,
    l10n.L10N_TABLE_ARCHIVE_FILE,
  )
  stage.archive = brotliDecompressSync(readFileSync(archiveFile)).toString('utf8')
}, PACK_SETUP_TIMEOUT_MS)

afterAll(() => rmSync(stage.dir, { recursive: true, force: true }))

describe('packaged UI tables match their sources', () => {
  it.each(TABLE_LOCALES)('decodes l10n/ui.%s.json exactly as its source', (locale) => {
    const source = JSON.parse(readFileSync(path.join(root, 'l10n', `ui.${locale}.json`), 'utf8'))
    const shipped = JSON.parse(readArchivedUiTable(stage.archive, locale))
    expect(divergence(shipped, source)).toBe(null)
  })
})

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { unpackUiTable } from '../../src/shared/l10n/packed'

const PYTHON = ['python3', 'python', 'py'].find(
  (candidate) => spawnSync(candidate, ['--version']).status === 0,
)

function python(args) {
  if (PYTHON === undefined) throw new Error('Python is required for the VSIX packaging tests')
  return spawnSync(PYTHON, args, { encoding: 'utf8' })
}

describe('VSIX maximum compression', () => {
  it('preserves archive metadata, ordinary bytes and every translated value', () => {
    mkdirSync(path.resolve('temp'), { recursive: true })
    const dir = mkdtempSync(path.resolve('temp/m97-vsix-'))
    const archive = path.join(dir, 'fixture.vsix')
    // Indexed packaging requires every English leaf, including whole plural
    // objects. Use a complete real table rather than the old three-key stub.
    const translatedFile = path.resolve('l10n/ui.cs.json')
    try {
      const made = python([
        '-c',
        `
import sys, json
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
with ZipFile(sys.argv[1], 'w', compression=ZIP_DEFLATED) as z:
    z.comment = b'archive comment'
    entry = ZipInfo('extension/tool')
    entry.external_attr = 0o100755 << 16
    entry.date_time = (2026, 10, 4, 12, 0, 0)
    z.writestr(entry, b'content' * 10000, compress_type=ZIP_DEFLATED)
    z.writestr('extension/LICENSE', b'license terms')
    ui = json.dumps({'title': 'Žluťoučký kůň', 'paragraph': 'two  spaces', 'forms': {'one': 'one ' + '{' + 'n}', 'other': 'other ' + '{' + 'n}'}}, ensure_ascii=False, indent=2).encode()
    z.writestr('extension/l10n/ui.cs.json', open(sys.argv[2], 'rb').read())
    z.writestr('extension/package.nls.cs.json', ui)
    z.writestr('extension/dist/legal-data/provenance.json', ui)
`,
        archive,
        translatedFile,
      ])
      expect(made.status, made.stderr).toBe(0)
      const run = spawnSync(process.execPath, ['scripts/compress-vsix.mjs', archive], {
        encoding: 'utf8',
      })
      expect(run.status, run.stderr).toBe(0)
      const checked = python([
        '-c',
        `
import sys, json
from zipfile import ZipFile
with ZipFile(sys.argv[1]) as z:
    assert z.namelist() == ['extension/tool', 'extension/LICENSE', 'extension/l10n/ui.cs.json', 'extension/package.nls.cs.json', 'extension/dist/legal-data/provenance.json']
    expected = {'title': 'Žluťoučký kůň', 'paragraph': 'two  spaces', 'forms': {'one': 'one ' + '{' + 'n}', 'other': 'other ' + '{' + 'n}'}}
    pretty = json.dumps(expected, ensure_ascii=False, indent=2).encode()
    assert json.loads(z.read('extension/package.nls.cs.json')) == expected
    assert len(z.read('extension/package.nls.cs.json')) < len(pretty)
    packed = json.loads(z.read('extension/l10n/ui.cs.json'))
    assert packed['format'] == 1
    assert len(z.read('extension/l10n/ui.cs.json')) < len(open(sys.argv[2], 'rb').read())
    assert z.read('extension/dist/legal-data/provenance.json') == pretty
    assert z.comment == b'archive comment'
    assert z.read('extension/tool') == b'content' * 10000
    assert z.read('extension/LICENSE') == b'license terms'
    assert z.getinfo('extension/tool').external_attr == 0o100755 << 16
    assert z.getinfo('extension/tool').date_time == (2026, 10, 4, 12, 0, 0)
    assert z.testzip() is None
    print(json.dumps(packed, ensure_ascii=True))
`,
        archive,
        translatedFile,
      ])
      expect(checked.status, checked.stderr).toBe(0)
      expect(unpackUiTable(JSON.parse(checked.stdout))).toEqual(
        JSON.parse(readFileSync(translatedFile, 'utf8')),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('refuses malformed translated JSON without replacing the original archive', () => {
    mkdirSync(path.resolve('temp'), { recursive: true })
    const dir = mkdtempSync(path.resolve('temp/m97-vsix-'))
    const archive = path.join(dir, 'fixture.vsix')
    try {
      const made = python([
        '-c',
        "import sys; from zipfile import ZipFile; z=ZipFile(sys.argv[1], 'w'); z.writestr('extension/l10n/ui.cs.json', b'{invalid'); z.close()",
        archive,
      ])
      expect(made.status, made.stderr).toBe(0)
      const before = readFileSync(archive)
      const run = spawnSync(process.execPath, ['scripts/compress-vsix.mjs', archive], {
        encoding: 'utf8',
      })
      expect(run.status).not.toBe(0)
      expect(readFileSync(archive)).toEqual(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PYTHON = ['python3', 'python', 'py'].find(
  (candidate) => spawnSync(candidate, ['--version']).status === 0,
)

function python(args) {
  if (PYTHON === undefined) throw new Error('Python is required for the VSIX packaging tests')
  return spawnSync(PYTHON, args, { encoding: 'utf8' })
}

describe('VSIX maximum compression', () => {
  it('preserves entry order, content, archive comment and executable metadata', () => {
    mkdirSync(path.resolve('temp'), { recursive: true })
    const dir = mkdtempSync(path.resolve('temp/m97-vsix-'))
    const archive = path.join(dir, 'fixture.vsix')
    try {
      const made = python([
        '-c',
        `
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
with ZipFile(sys.argv[1], 'w', compression=ZIP_DEFLATED) as z:
    z.comment = b'archive comment'
    entry = ZipInfo('extension/tool')
    entry.external_attr = 0o100755 << 16
    entry.date_time = (2026, 10, 4, 12, 0, 0)
    z.writestr(entry, b'content' * 10000, compress_type=ZIP_DEFLATED)
    z.writestr('extension/LICENSE', b'license terms')
`,
        archive,
      ])
      expect(made.status, made.stderr).toBe(0)
      const run = spawnSync(process.execPath, ['scripts/compress-vsix.mjs', archive], {
        encoding: 'utf8',
      })
      expect(run.status, run.stderr).toBe(0)
      const checked = python([
        '-c',
        `
import sys
from zipfile import ZipFile
with ZipFile(sys.argv[1]) as z:
    assert z.namelist() == ['extension/tool', 'extension/LICENSE']
    assert z.comment == b'archive comment'
    assert z.read('extension/tool') == b'content' * 10000
    assert z.read('extension/LICENSE') == b'license terms'
    assert z.getinfo('extension/tool').external_attr == 0o100755 << 16
    assert z.getinfo('extension/tool').date_time == (2026, 10, 4, 12, 0, 0)
    assert z.testzip() is None
`,
        archive,
      ])
      expect(checked.status, checked.stderr).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

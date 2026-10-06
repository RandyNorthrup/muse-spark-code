import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../os/', import.meta.url))
const temporary = []
function directory() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'm110-os1-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function python(code) {
  return spawnSync('python3', ['-c', code], { encoding: 'utf8' })
}
describe('M110-OS1 immutable image inputs', () => {
  it('accepts the pinned Debian/Node policy and A/B partition layout', () => {
    expect(execFileSync('python3', [path.join(root, 'check.py')], { encoding: 'utf8' })).toContain(
      '0 problems',
    )
  })
  it.each([
    ['mkosi.conf', 'Snapshot=20261005T000000Z', 'Snapshot=latest', 'snapshot pin'],
    ['mkosi.conf', 'SourceDateEpoch=1791158400', 'SourceDateEpoch=0', 'source epoch pin'],
    ['repart/20-usr-a.conf', 'Verity=data', 'Verity=off', 'usr integrity'],
    ['repart/20-usr-a.conf', 'ReadOnly=yes', 'ReadOnly=no', 'read-only usr'],
    ['repart/30-usr-b.conf', 'NoAuto=yes', 'NoAuto=no', 'inactive slot admission'],
    ['repart/30-usr-b.conf', 'SizeMinBytes=1536M', 'SizeMinBytes=1M', 'equal slots'],
    [
      'overlay/usr/lib/systemd/system/muse-node.service',
      'User=muse-node',
      'User=root',
      'non-root service',
    ],
  ])('refuses a weakened %s guard (%s)', (file, before, after, reason) => {
    const dir = directory()
    cpSync(root, dir, { recursive: true })
    const target = path.join(dir, ...file.split('/'))
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace(before, () => after),
    )
    const result = spawnSync('python3', [path.join(root, 'check.py'), dir], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(reason)
  })
  it.each(['package/../outside', String.raw`package\outside`, '/absolute', 'package/key'])(
    'rejects untrusted archive path %s before extraction',
    (name) => {
      const dir = directory()
      const result = python(`
import sys, tarfile, io
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from build import extract
archive = Path(${JSON.stringify(path.join(dir, 'bad.tar'))})
with tarfile.open(archive, 'w') as output:
    item = tarfile.TarInfo(${JSON.stringify(name)})
    item.size = 1
    output.addfile(item, io.BytesIO(b'x'))
extract(archive, Path(${JSON.stringify(path.join(dir, 'image'))}), 'package', lambda name: ${name === 'package/key' ? 'False' : 'True'})
`)
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/unsafe archive member|unexpected archive member/u)
    },
  )
  it('refuses an archive symlink without writing an earlier valid member', () => {
    const dir = directory()
    const result = python(`
import sys, tarfile, io
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from build import extract
archive = Path(${JSON.stringify(path.join(dir, 'link.tar'))})
dest = Path(${JSON.stringify(path.join(dir, 'image'))})
with tarfile.open(archive, 'w') as output:
    item = tarfile.TarInfo('package/dist/node.js')
    item.size = 1
    output.addfile(item, io.BytesIO(b'x'))
    link = tarfile.TarInfo('package/link')
    link.type = tarfile.SYMTYPE
    link.linkname = '/outside'
    output.addfile(link)
try:
    extract(archive, dest, 'package', lambda name: True)
except ValueError:
    assert not dest.exists()
    print('refused before writes')
else:
    raise AssertionError('accepted symlink')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused before writes')
  })
  it('refuses a corrupt pinned download and removes partial bytes', () => {
    const dir = directory()
    const source = path.join(dir, 'source')
    writeFileSync(source, 'corrupt input')
    const result = python(`
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(root)})
from build import download
dest = Path(${JSON.stringify(path.join(dir, 'asset'))})
try:
    download(Path(${JSON.stringify(source)}).as_uri(), '0' * 64, dest)
except ValueError:
    assert not dest.exists() and not dest.with_suffix('.partial').exists()
    print('refused digest')
else:
    raise AssertionError('accepted mismatch')
`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('refused digest')
  })
})

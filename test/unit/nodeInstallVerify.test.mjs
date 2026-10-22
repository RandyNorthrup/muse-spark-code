// deploy/install/verify-node-install.mjs is a command: the tests run it as
// one, the way the rented-server installer runs it over its artifact. A
// well-formed artifact verifies; a tampered hash, a missing file, planted
// key material, no input and a symlinked start directory each refuse.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = 'deploy/install/verify-node-install.mjs'
const root = mkdtempSync(path.join(tmpdir(), 'muse-node-verify-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function artifact(files) {
  const dir = mkdtempSync(path.join(root, 'artifact-'))
  const lines = []
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
    lines.push(`${createHash('sha256').update(content).digest('hex')}  ${name}`)
  }
  writeFileSync(path.join(dir, 'SHA256SUMS'), `${lines.join('\n')}\n`)
  return dir
}

function verify(...argv) {
  return spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8' })
}

describe('node install verifier', () => {
  it('verifies a well-formed artifact, through a symlinked directory too', () => {
    const dir = artifact({ 'muse-node': 'binary-bytes', 'node.service': 'unit-bytes' })
    const ok = verify(dir)
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain('verified 2 files')
    const link = path.join(root, 'linked-artifact')
    symlinkSync(dir, link)
    expect(verify(link).status).toBe(0)
  })

  it('refuses a tampered hash, a missing file and planted key material', () => {
    const tampered = artifact({ 'muse-node': 'binary-bytes' })
    writeFileSync(path.join(tampered, 'muse-node'), 'other-bytes')
    const bad = verify(tampered)
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('checksum mismatch: muse-node')

    const missing = artifact({ 'muse-node': 'binary-bytes', 'extra.txt': 'x' })
    rmSync(path.join(missing, 'extra.txt'))
    const gone = verify(missing)
    expect(gone.status).toBe(1)
    expect(gone.stderr).toContain('missing artifact file: extra.txt')

    const keyed = artifact({ 'muse-node': 'binary-bytes' })
    const planted = 'accidentally committed PRIVATE KEY material'
    writeFileSync(path.join(keyed, 'notes.txt'), planted)
    const plantedHash = createHash('sha256').update(planted).digest('hex')
    const binaryHash = createHash('sha256').update('binary-bytes').digest('hex')
    writeFileSync(
      path.join(keyed, 'SHA256SUMS'),
      `${binaryHash}  muse-node\n${plantedHash}  notes.txt\n`,
    )
    const leaked = verify(keyed)
    expect(leaked.status).toBe(1)
    expect(leaked.stderr).toContain('private key material in notes.txt')
  })

  it('refuses missing input', () => {
    expect(verify().status).toBe(2)
    expect(verify(path.join(root, 'no-such-dir')).status).toBe(2)
  })
})

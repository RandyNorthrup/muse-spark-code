// M110os OS6: the reproducibility comparison. os-repro-check runs as a
// child process over real directory trees: record and check round
// trips, every divergence named, bad input refused, and a start
// through a symlinked directory.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPRO_CHECK = fileURLToPath(new URL('../../scripts/os-repro-check.mjs', import.meta.url))

function run(args: string[], script: string = REPRO_CHECK): { status: number | null; out: string } {
  const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

function scratch(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function writeTree(root: string, files: Record<string, string>): string {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return root
}

describe('os-repro-check', () => {
  it('records and checks an identical tree', () => {
    const dir = scratch('node-os-repro-')
    const tree = writeTree(path.join(dir, 'tree'), {
      'image.raw': 'image bytes',
      'nested/manifest.json': '{"v":1}',
    })
    const record = path.join(dir, 'hashes.json')
    const recorded = run(['--record', tree, '--out', record])
    expect(recorded.status).toBe(0)
    expect(recorded.out).toContain('recorded 2 files')
    const recordText = readFileSync(record, 'utf8')
    expect(recordText).toMatch(/"image\.raw": "[0-9a-f]{64}"/)
    expect(recordText).toMatch(/"nested\/manifest\.json": "[0-9a-f]{64}"/)
    const checked = run(['--check', tree, '--against', record])
    expect(checked.status).toBe(0)
    expect(checked.out).toContain('identical')
  })

  it('names every divergence', () => {
    const dir = scratch('node-os-repro-div-')
    const first = writeTree(path.join(dir, 'a'), {
      'same.txt': 'same',
      'changed.txt': 'before',
      'deleted.txt': 'gone',
    })
    const record = path.join(dir, 'hashes.json')
    expect(run(['--record', first, '--out', record]).status).toBe(0)
    const second = writeTree(path.join(dir, 'b'), {
      'same.txt': 'same',
      'changed.txt': 'after',
      'added.txt': 'new',
    })
    const checked = run(['--check', second, '--against', record])
    expect(checked.status).toBe(1)
    expect(checked.out).toContain('changed: changed.txt')
    expect(checked.out).toContain('only on the left: deleted.txt')
    expect(checked.out).toContain('only on the right: added.txt')
    expect(checked.out).not.toContain('same.txt')
  })

  it('compares two trees', () => {
    const dir = scratch('node-os-repro-cmp-')
    const first = writeTree(path.join(dir, 'a'), { 'f.txt': 'same' })
    const second = writeTree(path.join(dir, 'b'), { 'f.txt': 'same' })
    expect(run(['--compare', first, second]).status).toBe(0)
    writeFileSync(path.join(second, 'f.txt'), 'different')
    const compared = run(['--compare', first, second])
    expect(compared.status).toBe(1)
    expect(compared.out).toContain('changed: f.txt')
  })

  it('refuses bad input', () => {
    const dir = scratch('node-os-repro-bad-')
    const cases: { args: string[]; anchor: string }[] = [
      { args: [], anchor: 'exactly one of --record, --check and --compare' },
      { args: ['--record', dir], anchor: '--record needs DIR and --out FILE' },
      {
        args: ['--record', path.join(dir, 'absent'), '--out', path.join(dir, 'o.json')],
        anchor: 'not a directory',
      },
      { args: ['--check', dir], anchor: '--check needs exactly --against' },
      {
        args: ['--compare', dir],
        anchor: '--compare needs exactly DIR-A DIR-B',
      },
      {
        args: ['--record', dir, '--out', path.join(dir, 'o.json'), '--check', dir],
        anchor: 'exactly one of --record, --check and --compare',
      },
    ]
    for (const { args, anchor } of cases) {
      const result = run(args)
      expect(result.status).toBe(2)
      expect(result.out).toContain(anchor)
    }
    const malformed = path.join(dir, 'malformed.json')
    writeFileSync(malformed, '{not json')
    const badRecord = run(['--check', dir, '--against', malformed])
    expect(badRecord.status).toBe(2)
    expect(badRecord.out).toContain('not JSON')
  })

  it('starts through a symlinked directory', () => {
    const dir = scratch('node-os-repro-link-')
    const link = path.join(dir, 'scripts')
    symlinkSync(path.dirname(REPRO_CHECK), link, 'dir')
    const first = writeTree(path.join(dir, 'a'), { 'f.txt': 'same' })
    const second = writeTree(path.join(dir, 'b'), { 'f.txt': 'same' })
    const result = run(['--compare', first, second], path.join(link, 'os-repro-check.mjs'))
    expect(result.status).toBe(0)
  })
})

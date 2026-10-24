// M110r Y4: the fault rig as a person runs it: lists, refuses bad
// usage, probes namespaces, and passes a real scenario, including
// through a symlinked checkout.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = path.resolve(__dirname, '..', '..')
const RIG = path.join(REPO, 'scripts', 'fault-rig.mjs')

function runRig(args: readonly string[], cwd: string = REPO) {
  return spawnSync(process.execPath, [RIG, ...args], { encoding: 'utf8', cwd })
}

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

describe('fault-rig.mjs', () => {
  it('lists its scenarios', () => {
    const run = runRig(['list'])
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('s1-stream-cut\n')
    expect(run.stdout).toContain('s4-partition\n')
  })
  it('refuses an unknown scenario and bare usage', () => {
    expect(runRig(['run', 'nope']).status).toBe(1)
    expect(runRig(['run']).status).toBe(1)
    expect(runRig([]).status).toBe(1)
  })
  it('probes the namespace requirement aloud', () => {
    const run = runRig(['probe'])
    expect(run.status).toBe(0)
    expect(run.stdout).toMatch(/^namespaces: (available|refused: .+)$/m)
  })
  it('passes a real scenario end to end', () => {
    const run = runRig(['run', 's1-stream-cut'])
    expect(run.stdout).toContain('s1-stream-cut: PASS')
    expect(run.status).toBe(0)
  })
  it('runs through a symlinked checkout', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fault-link-'))
    dirs.push(dir)
    const link = path.join(dir, 'repo')
    // Windows's directory link is a junction (a symlink needs the
    // symbolic-link privilege, which a test account does not hold).
    symlinkSync(REPO, link, process.platform === 'win32' ? 'junction' : 'dir')
    const run = runRig(['list'], link)
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('s1-stream-cut\n')
  })
})

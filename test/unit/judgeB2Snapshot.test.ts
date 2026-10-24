// M125 lane F2: the frozen snapshot over real filesystem fixtures —
// the copy without `.git` or specials, the read-only lock, the
// budgets, the guarded reader, and the closure validated against
// frozen bytes.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, symlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  collectB2Closure,
  parseB2Command,
  parseB2PackageJson,
} from '../../src/core/judge/fast/b2Closure'
import { copyB2Snapshot, openB2SnapshotReader } from '../../src/core/judge/fast/b2Snapshot'

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'b2-snap-'))
  const workspace = path.join(root, 'workspace')
  await mkdir(path.join(workspace, '.git', 'objects'), { recursive: true })
  await mkdir(path.join(workspace, 'nested', '.git'), { recursive: true })
  await mkdir(path.join(workspace, 'src'), { recursive: true })
  await writeFile(path.join(workspace, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  await writeFile(path.join(workspace, 'nested', '.git', 'x'), 'nested\n')
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest --config vitest.config.ts' } }),
  )
  await writeFile(path.join(workspace, 'vitest.config.ts'), 'config\n')
  await writeFile(path.join(workspace, 'src', 'a.ts'), 'code\n')
  symlinkSync('src/a.ts', path.join(workspace, 'current'))
  return workspace
}

// B2 is off on Windows by design (PLAN.md M125: B2 on Linux only, off on
// Windows; it is not wired into any product path there), and the fixture's
// relative file link is one Windows grants only with the symbolic-link
// privilege, which a test account does not hold.
const IS_B2_HOST = process.platform !== 'win32'

describe.runIf(IS_B2_HOST)('B2 snapshot copy', () => {
  it('copies files, links and modes without .git', async () => {
    const workspace = await fixture()
    const target = `${workspace}-snap`
    const verdict = await copyB2Snapshot(workspace, target)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.snapshot.files).toBe(4)
    expect(await readFile(path.join(target, 'vitest.config.ts'), 'utf8')).toBe('config\n')
    expect(await readFile(path.join(target, 'src', 'a.ts'), 'utf8')).toBe('code\n')
    expect(lstatSync(path.join(target, 'current')).isSymbolicLink()).toBe(true)
    expect(existsSync(path.join(target, '.git'))).toBe(false)
    expect(existsSync(path.join(target, 'nested', '.git'))).toBe(false)
    expect(lstatSync(path.join(target, 'vitest.config.ts')).mode & 0o222).toBe(0)
    expect(lstatSync(path.join(target, 'src')).mode & 0o222).toBe(0)
  })

  it.skipIf(process.platform === 'win32')('leaves specials out', async () => {
    const workspace = await fixture()
    execFileSync('mkfifo', [path.join(workspace, 'pipe')])
    const target = `${workspace}-snap`
    const verdict = await copyB2Snapshot(workspace, target)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(existsSync(path.join(target, 'pipe'))).toBe(false)
    expect(verdict.snapshot.files).toBe(4)
  })

  it('abandons past either budget and removes the target', async () => {
    const workspace = await fixture()
    const small = `${workspace}-small`
    const size = await copyB2Snapshot(workspace, small, { maxMs: 60_000, maxMib: 0 })
    expect(size).toMatchObject({ ok: false, reason: 'budgetSize' })
    expect(existsSync(small)).toBe(false)
    // A negative time budget trips the check on the first entry: the
    // mechanism probe, not a real budget.
    const slow = `${workspace}-slow`
    const time = await copyB2Snapshot(workspace, slow, { maxMs: -1, maxMib: 4096 })
    expect(time).toMatchObject({ ok: false, reason: 'budgetTime' })
    expect(existsSync(slow)).toBe(false)
  })

  it('names source and target failures', async () => {
    const missing = path.join(os.tmpdir(), 'b2-snap-missing-source')
    const target = `${missing}-snap`
    const source = await copyB2Snapshot(missing, target)
    expect(source).toMatchObject({ ok: false, reason: 'source', code: 'ENOENT' })
    const workspace = await fixture()
    const blocker = path.join(workspace, 'src', 'a.ts')
    const blocked = await copyB2Snapshot(workspace, path.join(blocker, 'snap'))
    expect(blocked).toMatchObject({ ok: false, reason: 'target' })
  })
})

describe.runIf(IS_B2_HOST)('B2 snapshot reader', () => {
  it('reads through the guard and never outside', async () => {
    const workspace = await fixture()
    const target = `${workspace}-snap`
    const verdict = await copyB2Snapshot(workspace, target)
    if (!verdict.ok) throw new Error('the drill snapshot must copy')
    const reader = openB2SnapshotReader(verdict.snapshot)
    expect(reader.statEntry('vitest.config.ts')).toBe('file')
    expect(reader.statEntry('current')).toBe('link')
    expect(reader.statEntry('missing.txt')).toBe('other')
    expect(reader.statEntry('../outside.txt')).toBe('other')
    expect(reader.statEntry('/abs.txt')).toBe('other')
    expect(reader.readEntryBytes('vitest.config.ts')?.toString()).toBe('config\n')
    expect(reader.readEntryBytes('../outside.txt')).toBeUndefined()
    expect(reader.readEntryLink('current')).toBe('src/a.ts')
  })

  it('validates the closure against frozen bytes', async () => {
    const workspace = await fixture()
    const target = `${workspace}-snap`
    const verdict = await copyB2Snapshot(workspace, target)
    if (!verdict.ok) throw new Error('the drill snapshot must copy')
    const command = parseB2Command('npm test')
    if (!command.ok) throw new Error('the drill command must parse')
    const collect = async (): Promise<string> => {
      const manifest = parseB2PackageJson(
        await readFile(path.join(workspace, 'package.json'), 'utf8'),
      )
      if (!manifest.ok) throw new Error('the drill manifest must parse')
      const collected = collectB2Closure(
        command.command,
        manifest.packageJson,
        { yarnLock: false, yarnrc: false, yarnrcYml: false, pnpmfile: false },
        [],
        openB2SnapshotReader(verdict.snapshot),
      )
      if (!collected.ok) throw new Error('the drill closure must collect')
      const config = collected.closure.files.find((file) => file.path === 'vitest.config.ts')
      if (config?.kind !== 'file') throw new Error('the drill closure must pin its config')
      return Buffer.from(config.bytes).toString('utf8')
    }
    expect(await collect()).toBe('config\n')
    await writeFile(path.join(workspace, 'vitest.config.ts'), 'live edit\n')
    expect(await collect()).toBe('config\n')
  })
})

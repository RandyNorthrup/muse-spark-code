// M116 (D217): the headless check spawn runs one shell line in the
// workspace and answers its exit code, or the timeout once the check's
// own cap kills its tree. Shell lines are the shells' own (`exit`,
// `sleep`), quiet on both interpreters.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { spawnCheckLine, type SpawnCheckDeps } from '../../src/runtime/playbook/spawnCheck'

function scratchWorkspace(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const workspace = path.join(directory, 'workspace')
  mkdirSync(workspace, { recursive: true })
  return workspace
}

function deps(workspaceRoot: string, overrides?: Partial<SpawnCheckDeps>): SpawnCheckDeps {
  return {
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    workspaceRoot,
    env: process.env,
    fileExists: existsSync,
    realpath: realpathSync,
    log: () => undefined,
    ...overrides,
  }
}

describe('spawnCheckLine', () => {
  it('answers the check’s exit code', async () => {
    const workspace = scratchWorkspace('m116w-spawn-code-')
    await expect(spawnCheckLine('exit 0', 30_000, deps(workspace))).resolves.toEqual({
      ok: true,
      code: 0,
    })
    await expect(spawnCheckLine('exit 3', 30_000, deps(workspace))).resolves.toEqual({
      ok: true,
      code: 3,
    })
  })

  it('runs in the workspace', async () => {
    const workspace = scratchWorkspace('m116w-spawn-cwd-')
    // The line writes where it runs; the test reads the file back.
    const line =
      process.platform === 'win32'
        ? 'Set-Content -Path witness.txt -Value witness'
        : 'echo witness > witness.txt'
    await expect(spawnCheckLine(line, 30_000, deps(workspace))).resolves.toEqual({
      ok: true,
      code: 0,
    })
    await expect(readFile(path.join(workspace, 'witness.txt'), 'utf8')).resolves.toContain(
      'witness',
    )
  })

  it('kills the tree on the timeout', async () => {
    const workspace = scratchWorkspace('m116w-spawn-timeout-')
    await expect(spawnCheckLine('sleep 30', 500, deps(workspace))).resolves.toEqual({
      ok: false,
      reason: 'timeout',
    })
  })

  it('says unavailable when no interpreter exists outside the workspace', async () => {
    const workspace = scratchWorkspace('m116w-spawn-nointerp-')
    const logs: string[] = []
    await expect(
      spawnCheckLine(
        'exit 0',
        30_000,
        deps(workspace, {
          fileExists: () => false,
          log: (message) => {
            logs.push(message)
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(logs).toEqual(['no shell interpreter outside the workspace'])
  })

  it('says unavailable when the interpreter vanishes before the spawn', async () => {
    const workspace = scratchWorkspace('m116w-spawn-vanished-')
    const logs: string[] = []
    // Every PATH spelling goes: on Windows the inherited `Path` would
    // otherwise still resolve a real interpreter.
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (key.toLowerCase() !== 'path') env[key] = value
    }
    env['PATH'] = path.join(tmpdir(), 'm116w-vanished-shell')
    await expect(
      spawnCheckLine(
        'exit 0',
        30_000,
        deps(workspace, {
          // The probe passes but the spawn fails: the TOCTOU race between
          // resolving the interpreter and starting it.
          systemRoot: undefined,
          fileExists: () => true,
          env,
          log: (message) => {
            logs.push(message)
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(logs).toEqual(['the check could not start'])
  })
})

// A suite finds a real Muse Code only when the run asks for one. The CLI planted here sits where
// the product's own lookup finds one, and is only ever found, never started: an empty file.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { museCommand } from './helpers/acpRecoverRig'
import { resolveInstalledMuse } from './helpers/installedMuse'
import { isRealMuseAsked, REAL_MUSE_VARIABLE } from './helpers/realMuse'

const scene: { folder: string; path: string | undefined; asked: string | undefined } = {
  folder: '',
  path: undefined,
  asked: undefined,
}

function setAsked(value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, REAL_MUSE_VARIABLE)
  else process.env[REAL_MUSE_VARIABLE] = value
}

beforeEach(() => {
  scene.path = process.env['PATH']
  scene.asked = process.env[REAL_MUSE_VARIABLE]
  // Under the repository: the lookup never probes a PATH entry inside its workspace, tmpdir().
  mkdirSync('temp', { recursive: true })
  scene.folder = mkdtempSync(path.join(path.resolve('temp'), 'real-muse-gate-'))
  const names =
    process.platform === 'win32' ? ['muse.cmd', 'muse-bin-1.0.0.exe', '.muse-version'] : ['muse']
  for (const name of names) writeFileSync(path.join(scene.folder, name), '')
  process.env['PATH'] = [scene.folder, scene.path].join(path.delimiter)
})

afterEach(() => {
  process.env['PATH'] = scene.path
  setAsked(scene.asked)
  rmSync(scene.folder, { recursive: true, force: true })
})

const installed = () => resolveInstalledMuse({ localAppData: undefined, workspaceRoot: tmpdir() })

describe('a real Muse Code in a suite', () => {
  it.each([undefined, '', '0', 'true'])('is not found while the variable is %s', (value) => {
    setAsked(value)
    expect(isRealMuseAsked()).toBe(false)
    expect(museCommand()).toBeUndefined()
    expect(installed()).toEqual({ missing: expect.stringContaining(REAL_MUSE_VARIABLE) as string })
  })

  it('is found where the product finds it once the run asks', () => {
    setAsked('1')
    expect(isRealMuseAsked()).toBe(true)
    expect(path.dirname(museCommand() ?? '')).toBe(scene.folder)
    const found = installed()
    expect('command' in found && path.dirname(found.command)).toBe(scene.folder)
  })
})

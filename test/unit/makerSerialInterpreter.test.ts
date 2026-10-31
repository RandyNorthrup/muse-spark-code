import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSerialInterpreter } from '../../src/core/maker/serial/interpreter'
import { runtimeSerialPythonPath } from '../../src/runtime/runtimeSerialPython'
import { resolveExecutable } from '../../src/core/execGuard'
import { NO_WORKSPACE } from '../../src/core/executables'
import { RUNTIME_SETTINGS_FILE, UI_TEXT } from '../../src/shared/constants'
import { makerTempRoot } from './helpers/makerTemp'

const run = promisify(execFile)

// The machine's own python3, found the way the product finds a tool outside any workspace.
const realPython =
  process.platform === 'win32'
    ? undefined
    : resolveExecutable('python3', {
        platform: process.platform,
        pathVariable: process.env['PATH'],
        fileExists: existsSync,
        scope: { noWorkspace: NO_WORKSPACE, realpath: realpathSync },
      })

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

/** A workspace holding a planted `python3` that records that it ran. */
async function plantedWorkspace() {
  const workspace = realpathSync(await mkdtemp(path.join(makerTempRoot(), 'serial-python-')))
  folders.push(workspace)
  const planted = path.join(workspace, 'bin')
  const marker = path.join(workspace, 'planted-ran')
  await mkdir(planted)
  const script = path.join(planted, 'python3')
  await writeFile(script, `#!/bin/sh\necho ran > '${marker}'\n`)
  await chmod(script, 0o755)
  return { workspace, planted, script, marker }
}

function probe(workspace: string, pathVariable: string) {
  return {
    platform: process.platform,
    env: { PATH: pathVariable },
    workspaceRoot: workspace,
    fileExists: existsSync,
    realpath: realpathSync,
  }
}

async function didRun(marker: string): Promise<boolean> {
  try {
    await readFile(marker, 'utf8')
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

describe.skipIf(process.platform === 'win32')('the serial helper’s interpreter', () => {
  it('is real: a bare python3 on a relative PATH entry runs the planted program', async () => {
    const { workspace, marker } = await plantedWorkspace()
    await run('python3', ['-c', ''], { cwd: workspace, env: { PATH: `bin:${workspace}/bin` } })
    expect(await didRun(marker)).toBe(true)
  })

  it.skipIf(realPython === undefined)(
    'never runs a planted python3 first on PATH, absolute or relative, and runs the real one',
    async () => {
      const { workspace, planted, marker } = await plantedWorkspace()
      const realDirectory = path.dirname(realPython ?? '')
      for (const pathVariable of [
        `${planted}:${realDirectory}`,
        `bin:.:${planted}:${realDirectory}`,
      ]) {
        const interpreter = resolveSerialInterpreter(probe(workspace, pathVariable))
        expect(interpreter).toBe(realPython)
        const { stdout } = await run(interpreter, ['-I', '-c', 'print("real interpreter")'], {
          cwd: workspace,
          env: { PATH: pathVariable },
        })
        expect(stdout.trim()).toBe('real interpreter')
        expect(await didRun(marker)).toBe(false)
      }
    },
  )

  it.skipIf(realPython === undefined)(
    'skips a link into the workspace and takes the next python3',
    async () => {
      const { workspace, script, marker } = await plantedWorkspace()
      const outside = realpathSync(await mkdtemp(path.join(makerTempRoot(), 'serial-link-')))
      folders.push(outside)
      await symlink(script, path.join(outside, 'python3'))
      const realDirectory = path.dirname(realPython ?? '')
      expect(resolveSerialInterpreter(probe(workspace, `${outside}:${realDirectory}`))).toBe(
        realPython,
      )
      expect(await didRun(marker)).toBe(false)
    },
  )

  it('says what is missing and what to do when only a planted python3 is on PATH', async () => {
    const { workspace, planted, marker } = await plantedWorkspace()
    for (const pathVariable of [planted, `bin:.:${planted}`, '']) {
      expect(() => resolveSerialInterpreter(probe(workspace, pathVariable))).toThrow(
        UI_TEXT.makerSerialPythonMissing,
      )
    }
    expect(await didRun(marker)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('a Python the person set for serial access', () => {
  it.skipIf(realPython === undefined)(
    'is the one started, as given, whatever PATH holds, so a virtual environment keeps its packages',
    async () => {
      const { workspace, planted, marker } = await plantedWorkspace()
      const venv = realpathSync(await mkdtemp(path.join(makerTempRoot(), 'serial-venv-')))
      folders.push(venv)
      await mkdir(path.join(venv, 'bin'))
      // A virtual environment's python3 is a link to a real interpreter; the
      // environment is found from the link's own place, so it is not resolved.
      const venvPython = path.join(venv, 'bin', 'python3')
      await symlink(realPython ?? '', venvPython)
      const interpreter = resolveSerialInterpreter({
        ...probe(workspace, planted),
        configured: venvPython,
      })
      expect(interpreter).toBe(venvPython)
      const { stdout } = await run(interpreter, ['-I', '-c', 'print("venv interpreter")'], {
        cwd: workspace,
        env: { PATH: planted },
      })
      expect(stdout.trim()).toBe('venv interpreter')
      expect(await didRun(marker)).toBe(false)
    },
  )

  it('refuses a set Python inside the workspace, by name or by a link, and never runs it', async () => {
    const { workspace, script, marker } = await plantedWorkspace()
    const outside = realpathSync(await mkdtemp(path.join(makerTempRoot(), 'serial-set-')))
    folders.push(outside)
    // A virtual environment inside the project: its python3 is a link to a
    // program outside, but the environment's packages are the project's.
    const inside = path.join(workspace, '.venv', 'bin')
    await mkdir(inside, { recursive: true })
    const linked = path.join(inside, 'python3')
    await symlink(process.execPath, linked)
    for (const configured of [script, linked]) {
      expect(() => resolveSerialInterpreter({ ...probe(workspace, outside), configured })).toThrow(
        UI_TEXT.makerSerialPythonSetInWorkspace,
      )
    }
    expect(await didRun(marker)).toBe(false)
  })

  it('says a set path that is relative or not a file is not one, and does not look on PATH instead', async () => {
    const { workspace, planted } = await plantedWorkspace()
    const outside = realpathSync(await mkdtemp(path.join(makerTempRoot(), 'serial-missing-')))
    folders.push(outside)
    const realDirectory = path.dirname(realPython ?? planted)
    for (const configured of ['python3', './python3', path.join(outside, 'no-such-python')]) {
      expect(() =>
        resolveSerialInterpreter({ ...probe(workspace, realDirectory), configured }),
      ).toThrow(UI_TEXT.makerSerialPythonSetMissing)
    }
  })

  it.skipIf(realPython === undefined)(
    'finds python3 on PATH as before when none is set',
    async () => {
      const { workspace, planted } = await plantedWorkspace()
      const realDirectory = path.dirname(realPython ?? '')
      for (const configured of [undefined, '']) {
        expect(
          resolveSerialInterpreter({
            ...probe(workspace, `${planted}:${realDirectory}`),
            configured,
          }),
        ).toBe(realPython)
      }
    },
  )

  it('is read from the agent’s own settings file at each use, and empty means unset', async () => {
    const dataFolder = realpathSync(await mkdtemp(path.join(makerTempRoot(), 'serial-setting-')))
    folders.push(dataFolder)
    expect(runtimeSerialPythonPath(dataFolder)).toBeUndefined()
    await writeFile(
      path.join(dataFolder, RUNTIME_SETTINGS_FILE),
      JSON.stringify({ serialPythonPath: '/opt/venv/bin/python3', paidDailyBudgetUsd: 5 }),
    )
    expect(runtimeSerialPythonPath(dataFolder)).toBe('/opt/venv/bin/python3')
    await writeFile(
      path.join(dataFolder, RUNTIME_SETTINGS_FILE),
      JSON.stringify({ serialPythonPath: '' }),
    )
    expect(runtimeSerialPythonPath(dataFolder)).toBeUndefined()
    expect(runtimeSerialPythonPath(dataFolder)).toBeUndefined()
  })
})

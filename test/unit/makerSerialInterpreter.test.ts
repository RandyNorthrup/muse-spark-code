import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSerialInterpreter } from '../../src/core/maker/serial/interpreter'
import { resolveExecutable } from '../../src/core/execGuard'
import { NO_WORKSPACE } from '../../src/core/executables'
import { UI_TEXT } from '../../src/shared/constants'
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

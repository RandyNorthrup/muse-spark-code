import { mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mcpJobExecutable, mcpJobExecutableName } from '../../src/host/backend/mcpJobExecutable'
import type { RunProgram } from '../../src/host/processTree'
import { SHELL_JOB_FOLDER } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { readJobSource } from './helpers/jobSource'

const paths = { root: '' }

beforeAll(async () => {
  paths.root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-mcp-executable-test-')))
})

afterAll(() => removeFolder(paths.root))

describe('M50 compiled Windows job executable', () => {
  it('compiles once and leaves M27 shell-job DLLs alone', async () => {
    const storageDir = await mkdtemp(path.join(paths.root, 'ready-'))
    const folder = path.join(storageDir, SHELL_JOB_FOLDER)
    await mkdir(folder)
    await writeFile(path.join(folder, 'MuseSparkMcpJob-old.exe'), 'stale')
    await writeFile(path.join(folder, 'MuseSparkJob-live.dll'), 'M27')
    const scripts: string[] = []
    const run: RunProgram = async (_file, args) => {
      if (args[0] === '--self-test') return 'muse-spark-mcp-job-ready\n'
      const script = args.join('\n')
      scripts.push(script)
      const output = args.find((arg) => arg.startsWith('/out:'))?.slice('/out:'.length)
      if (output === undefined) throw new Error('compiler output was not named')
      await writeFile(output, 'executable')
      return ''
    }
    const logged: string[] = []
    const deps = {
      readJobSource,
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: (message: string) => {
        logged.push(message)
      },
      run,
    }
    const ready = mcpJobExecutable(deps)
    const name = mcpJobExecutableName(await readJobSource('mcpLauncher'))
    const executable = path.join(folder, name)
    expect(await ready()).toBe(executable)
    expect(await ready()).toBe(executable)
    const left = await readdir(folder)
    expect(left.toSorted((a, b) => a.localeCompare(b))).toEqual(
      ['MuseSparkJob-live.dll', name].toSorted((a, b) => a.localeCompare(b)),
    )
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('/target:exe')
    expect(scripts[0]).toContain(
      String.raw`/reference:C:\Windows\Microsoft.NET\Framework\v4.0.30319\System.Runtime.Serialization.dll`,
    )
    expect(scripts[0]).toContain(
      String.raw`/reference:C:\Windows\Microsoft.NET\Framework\v4.0.30319\System.Xml.dll`,
    )
    expect(logged).toEqual([])
    let didRunAgain = false
    expect(
      await mcpJobExecutable({
        ...deps,
        run: (_file, args) => {
          if (args[0] === '--self-test') return Promise.resolve('muse-spark-mcp-job-ready\n')
          didRunAgain = true
          throw new Error('a cached executable must not be recompiled')
        },
      })(),
    ).toBe(executable)
    expect(didRunAgain).toBe(false)
  })

  it('fails closed when the compiler cannot build the launcher', async () => {
    const storageDir = await mkdtemp(path.join(paths.root, 'broken-'))
    const logged: string[] = []
    const ready = mcpJobExecutable({
      readJobSource,
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: (message) => {
        logged.push(message)
      },
      run: () => Promise.reject(new Error('compiler unavailable')),
    })
    expect(await ready()).toBeUndefined()
    expect(logged).toEqual([
      expect.stringContaining(
        'Windows MCP job executable is unavailable (Error: compiler unavailable)',
      ),
    ])
    expect(await readdir(path.join(storageDir, SHELL_JOB_FOLDER))).toEqual([])
  })

  it.skipIf(process.platform !== 'win32')(
    'rejects a corrupt cached executable before any MCP server can use it',
    async () => {
      const storageDir = await mkdtemp(path.join(paths.root, 'corrupt-'))
      const folder = path.join(storageDir, SHELL_JOB_FOLDER)
      await mkdir(folder)
      await writeFile(
        path.join(folder, mcpJobExecutableName(await readJobSource('mcpLauncher'))),
        'not a Windows executable',
      )
      const logged: string[] = []
      const ready = mcpJobExecutable({
        readJobSource,
        storageDir,
        systemRoot: process.env['SystemRoot'] ?? '',
        log: (message) => {
          logged.push(message)
        },
      })
      expect(await ready()).toBeUndefined()
      expect(logged.join('\n')).toContain('self-test')
    },
  )
})

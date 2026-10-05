import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mcpJobExecutable } from '../../src/host/backend/mcpJobExecutable'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import type { RunProgram } from '../../src/host/processTree'
import { SHELL_JOB_FOLDER } from '../../src/shared/constants'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '' }

beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'muse-job-build-'))
})

afterAll(() => removeFolder(paths.root))

const runWithoutAddType: RunProgram = async (_file, args) => {
  if (args.some((arg) => arg.includes('Add-Type'))) {
    throw new Error('PowerShell compiler startup timed out (killed=true, signal=SIGTERM)')
  }
  const output = args.find((arg) => arg.startsWith('/out:'))?.slice('/out:'.length)
  if (output !== undefined) {
    await writeFile(output, 'compiled helper')
    return ''
  }
  return args[0] === '--self-test' ? 'muse-spark-mcp-job-ready\n' : 'joined\n'
}

describe('Windows job helper compilation under load', () => {
  it.each([
    { name: 'MCP launcher', prepare: mcpJobExecutable },
    { name: 'shell assembly', prepare: shellJobAssembly },
  ])('prepares $name when PowerShell cannot start its Add-Type compiler', async ({ prepare }) => {
    const storageDir = await mkdtemp(path.join(paths.root, 'startup-failure-'))
    const logged: string[] = []
    const ready = prepare({
      readJobSource,
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      run: runWithoutAddType,
      log: (message) => {
        logged.push(message)
      },
    })
    const helper = await ready()
    expect(helper, logged.join('\n')).toBeDefined()
    expect(await ready()).toBe(helper)
    expect(logged).toEqual([])
    expect(await readdir(path.join(storageDir, SHELL_JOB_FOLDER))).toEqual([
      path.basename(helper ?? ''),
    ])
  })

  it.skipIf(process.platform !== 'win32')(
    'reports real compiler diagnostics and exit metadata without publishing partial output',
    async () => {
      const storageDir = await mkdtemp(path.join(paths.root, 'compiler-error-'))
      const logged: string[] = []
      const helper = await mcpJobExecutable({
        storageDir,
        systemRoot: process.env['SystemRoot'] ?? '',
        readJobSource: () => Promise.resolve('this is invalid C#'),
        log: (message) => {
          logged.push(message)
        },
      })()
      expect(helper).toBeUndefined()
      expect(logged.join('\n')).toContain('error CS')
      expect(logged.join('\n')).toContain('code=1')
      expect(logged.join('\n')).toContain('killed=false')
      expect(await readdir(path.join(storageDir, SHELL_JOB_FOLDER))).toEqual([])
    },
  )
})

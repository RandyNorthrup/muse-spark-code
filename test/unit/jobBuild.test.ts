import { mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mcpJobExecutable } from '../../src/host/backend/mcpJobExecutable'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import type { RunProgram } from '../../src/host/processTree'
import { SHELL_JOB_FOLDER } from '../../src/shared/constants'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', { spy: true })

const paths = { root: '' }
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'muse-job-build-'))
})

afterAll(() => removeFolder(paths.root))

const runWithoutAddType: RunProgram = async (_file, args, env) => {
  expect(env['GH_TOKEN']).toBeUndefined()
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
    vi.stubEnv('GH_TOKEN', 'envfence-fake')
    const storageDir = await mkdtemp(path.join(paths.root, 'startup-failure-'))
    const logged: string[] = []
    const ready = prepare({
      readJobSource,
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      run: async (file, args, env) => {
        const output = args.find((arg) => arg.startsWith('/out:'))?.slice('/out:'.length)
        if (output !== undefined)
          expect(path.dirname(output)).toBe(await realpath(path.join(storageDir, SHELL_JOB_FOLDER)))
        return await runWithoutAddType(file, args, env)
      },
      log: (message) => {
        logged.push(message)
      },
    })
    const helper = await ready()
    expect(helper, logged.join('\n')).toBeDefined()
    expect(helper).toBe(await realpath(helper!))
    expect(await ready()).toBe(helper)
    expect(logged).toEqual([])
    expect(await readdir(path.join(storageDir, SHELL_JOB_FOLDER))).toEqual([
      path.basename(helper ?? ''),
    ])
  })

  it('refuses a native path resolution that names a different directory identity', async () => {
    const storageDir = await mkdtemp(path.join(paths.root, 'identity-change-'))
    const replacement = await mkdtemp(path.join(paths.root, 'replacement-'))
    vi.spyOn(fsPromises, 'realpath').mockResolvedValue(replacement)
    const run = vi.fn(runWithoutAddType)
    const logged: string[] = []
    const helper = await shellJobAssembly({
      readJobSource,
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      run,
      log: (message) => {
        logged.push(message)
      },
    })()
    expect(helper).toBeUndefined()
    expect(run).not.toHaveBeenCalled()
    expect(logged.join('\n')).toContain('native identity changed')
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

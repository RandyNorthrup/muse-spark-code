import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as admission from '../../src/core/resources/admission'
import { runBootstrap } from '../../src/core/bootstrapCommand'
import { compileJob } from '../../src/host/backend/jobBuild'
import { windowsVaultExecutable } from '../../src/host/vault/slots/windowsVaultBuild'
import { fakeResourceLease } from './helpers/resources/fakes'
import { removeFolder } from './helpers/temporaryFolders'
import { ResourcePausedError } from '../../src/core/resources/launch'

vi.mock('../../src/core/resources/admission', { spy: true })
afterEach(() => vi.restoreAllMocks())

describe('bootstrap tier', () => {
  it('reports pause immediately without trying the second vault guard preparation', async () => {
    const admitted = vi
      .mocked(admission.admitBootstrap)
      .mockRejectedValue(new ResourcePausedError())
    await expect(
      windowsVaultExecutable({
        storageDir: process.cwd(),
        systemRoot: path.resolve('unavailable-system-root'),
        readSource: () =>
          Promise.resolve(
            '// BEGIN VAULT PATH GUARD\npublic class Fixture {}\n// END VAULT PATH GUARD',
          ),
      }),
    ).rejects.toMatchObject({ code: 'paused', message: 'Resources: Paused' })
    expect(admitted).toHaveBeenCalledOnce()
  })
  it('routes the job compiler through bootstrap admission', async () => {
    const parent = path.join(tmpdir(), 'l-SPAWN017B')
    await mkdir(parent, { recursive: true })
    const folder = await mkdtemp(path.join(parent, 'compile-'))
    const lease = fakeResourceLease()
    const admitted = vi.mocked(admission.admitBootstrap).mockResolvedValue(lease)
    try {
      // A rejected admission must occur before an unavailable compiler can run.
      admitted.mockRejectedValue(new Error('compiler paused'))
      await expect(
        compileJob(
          {
            stem: 'Fixture-',
            extension: '.dll',
            outputType: 'library',
            references: [],
            label: 'fixture',
            isPresent: () => Promise.resolve(false),
          },
          path.join(folder, 'fixture.dll'),
          'public class Fixture {}',
          path.resolve('unavailable-system-root'),
        ),
      ).rejects.toThrow('compiler paused')
      expect(admitted).toHaveBeenCalledOnce()
    } finally {
      await removeFolder(folder)
    }
  })
  it.each(['deadline', 'cancel'])(
    'kills a hung compiler and its child at %s before returning',
    async (reason) => {
      const parent = path.join(tmpdir(), 'l-SPAWN017B')
      await mkdir(parent, { recursive: true })
      const folder = await mkdtemp(path.join(parent, 'bootstrap-'))
      const marker = path.join(folder, 'pids.json')
      const lease = fakeResourceLease()
      vi.mocked(admission.admitBootstrap).mockResolvedValue(lease)
      const control = new AbortController()
      const timer =
        reason === 'cancel'
          ? setTimeout(() => {
              control.abort()
            }, 1000)
          : undefined
      try {
        await expect(
          runBootstrap(
            process.execPath,
            [
              '-e',
              `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:process.platform==='win32'}); child.unref(); require('node:fs').writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000)`,
              marker,
            ],
            { SystemRoot: process.env['SystemRoot'] },
            { timeoutMs: 1500, signal: control.signal },
          ),
        ).rejects.toThrow()
        const pids: unknown = JSON.parse(await readFile(marker, 'utf8'))
        if (!Array.isArray(pids)) throw new Error('Missing compiler tree')
        for (const pid of pids) {
          if (typeof pid !== 'number') throw new Error('Invalid compiler pid')
          expect(() => process.kill(pid, 0)).toThrow()
        }
        expect(lease.register).toHaveBeenCalledOnce()
        expect(lease.complete).toHaveBeenCalledWith(true)
      } finally {
        clearTimeout(timer)
        // Negative drills must not strand their deliberately uncontained fixture.
        try {
          const pids: unknown = JSON.parse(await readFile(marker, 'utf8'))
          if (Array.isArray(pids))
            for (const pid of pids) {
              if (typeof pid !== 'number') continue
              if (process.platform === 'win32') {
                try {
                  await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F'])
                } catch {
                  /* Already retired. */
                }
              } else {
                try {
                  process.kill(pid, 'SIGKILL')
                } catch {
                  /* Already retired. */
                }
              }
            }
        } catch {
          /* Failed before fixture launch. */
        }
        await removeFolder(folder)
      }
    },
  )

  it('refuses before launching when bootstrap admission is paused', async () => {
    vi.mocked(admission.admitBootstrap).mockRejectedValue(new Error('paused'))
    await expect(runBootstrap(process.execPath, ['-e', 'process.exit(0)'], {})).rejects.toThrow(
      'paused',
    )
  })

  it('names exit metadata on failure and reports output only to callers that ask', async () => {
    vi.mocked(admission.admitBootstrap).mockImplementation(() =>
      Promise.resolve(fakeResourceLease()),
    )
    const script =
      "process.stdout.write('stdout-diagnostic');process.stderr.write('stderr-diagnostic');process.exitCode=3"
    const failure = async (isOutputReported: boolean) => {
      try {
        await runBootstrap(
          process.execPath,
          ['-e', script],
          { SystemRoot: process.env['SystemRoot'] },
          { isOutputReported },
        )
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error)
      }
      throw new Error('bootstrap fixture succeeded')
    }
    const quiet = await failure(false)
    expect(quiet).toContain('code=3, killed=false, signal=null')
    expect(quiet).not.toContain('diagnostic')
    const reported = await failure(true)
    expect(reported).toContain('code=3, killed=false, signal=null')
    expect(reported).toContain('stdout-diagnostic')
    expect(reported).toContain('stderr-diagnostic')
  })

  it('bounds combined compiler output and waits for exit', async () => {
    const lease = fakeResourceLease()
    vi.mocked(admission.admitBootstrap).mockResolvedValue(lease)
    await expect(
      runBootstrap(
        process.execPath,
        ['-e', 'process.stdout.write(Buffer.alloc(2*1024*1024));setInterval(()=>{},1000)'],
        { SystemRoot: process.env['SystemRoot'] },
        { timeoutMs: 1000 },
      ),
    ).rejects.toMatchObject({ code: 'outputLimit' })
    expect(lease.complete).toHaveBeenCalledWith(true)
  })
})

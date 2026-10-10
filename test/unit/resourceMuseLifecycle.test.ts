import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as sdk from '@muse-code/sdk'
import * as fs from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resourceWindowsJob, admitResource } from '../../src/core/resources/admission'
import { nativeCreated, useCreatedNative } from './helpers/createdNative'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { TreeTempRoots } from '../../src/host/resources/tempRoots'
import type { ResourceLease } from '../../src/core/resources/launch'
import { spawnResourceMuseConnection } from '../../src/host/resources/museResourceLaunch'
import { connectAccountSession } from '../../src/host/auth/accountHost'
import { fakeMuseCodeManager } from './helpers/museCodeManager'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeInitializeResult } from './helpers/fakeMsp'
import { RESOURCE_TEMP_KEEP_MS } from '../../src/shared/constants'

useCreatedNative()

vi.mock('@muse-code/sdk', { spy: true })
vi.mock('node:fs/promises', { spy: true })
vi.mock('../../src/core/resources/admission', () => ({
  admitResource: vi.fn(),
  resourceWindowsJob: vi.fn(),
}))
afterEach(() => {
  vi.restoreAllMocks()
})

async function fixture() {
  const scratch = path.join(process.cwd(), 'temp')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(path.join(scratch, 'm107-dk-muse-'))
  let now = 0
  let hasExited = false
  let isFailed = false
  const registry = await CreatedRegistry.open(path.join(root, 'registry.json'), () => now, {
    directories: process.platform === 'linux' ? undefined : nativeCreated,
    files: nativeCreated,
    exited: () => Promise.resolve(hasExited),
    archivedAndClean: () => Promise.resolve(false),
    freeBytes: () => Promise.resolve(null),
  })
  const temp = await new TreeTempRoots(registry.base, registry).create('fixture-tree')
  let retirement: Promise<void> | undefined
  const lease: ResourceLease = {
    temp,
    register: vi.fn(),
    background: vi.fn(),
    failed: vi.fn(() => {
      isFailed = true
    }),
    complete: vi.fn(() => {
      hasExited = true
      retirement = temp.finish(isFailed)
    }),
  }
  vi.mocked(resourceWindowsJob).mockResolvedValue({
    executablePath: 'fixture.exe',
    assemblyPath: 'fixture.dll',
    verify: () => Promise.resolve(),
  })
  return {
    root,
    temp,
    registry,
    lease,
    settle: async () => {
      await retirement
    },
    advance: () => {
      now += RESOURCE_TEMP_KEEP_MS
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

describe('DK shared Muse spawn environment and failure retention', () => {
  it('projects the account host child environment into the owned root on POSIX', async () => {
    const h = await fixture()
    let session: Awaited<ReturnType<typeof connectAccountSession>> | undefined
    try {
      const script = path.join(h.root, 'account.cjs')
      const observed = path.join(h.root, 'observed.json')
      const result = { ...fakeInitializeResult, experimentalApi: true }
      await writeFile(
        script,
        String.raw`require('fs').writeFileSync(${JSON.stringify(observed)},JSON.stringify([process.env.TMPDIR,process.env.TEMP,process.env.TMP]));require('readline').createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);if(request.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:${JSON.stringify(result)}})+'\n')});process.stdin.on('end',()=>process.exit(0))`,
      )
      const manager = fakeMuseCodeManager()
      vi.spyOn(manager, 'resolveLaunch').mockReturnValue({
        ok: true,
        launch: {
          command: process.execPath,
          args: [script],
          serveArgs: [],
          installDir: h.root,
          cliPath: process.execPath,
        },
      })
      vi.spyOn(manager, 'childEnvironment').mockReturnValue({
        TMPDIR: 'outside',
        TEMP: 'outside',
        TMP: 'outside',
        SystemRoot: process.env['SystemRoot'],
      })
      vi.mocked(admitResource).mockResolvedValue(h.lease)
      if (process.platform === 'win32') {
        // The native job has its owning suite; this fixture launches the same projected SDK environment directly.
        const actual = await vi.importActual<typeof sdk>('@muse-code/sdk')
        vi.mocked(sdk.spawnMspConnection).mockImplementation((options) =>
          actual.spawnMspConnection({ ...options, command: process.execPath, args: [script] }),
        )
      }
      session = await connectAccountSession(
        manager,
        'fixture',
        new FakeLogOutputChannel(),
        undefined,
        new AbortController().signal,
      )
      expect(JSON.parse(await readFile(observed, 'utf8'))).toEqual([
        h.temp.root,
        h.temp.root,
        h.temp.root,
      ])
      await session.close()
      await h.settle()
      expect(h.lease.failed).not.toHaveBeenCalled()
    } finally {
      await session?.close()
      await h.settle()
      await h.cleanup()
    }
  })

  it.each(['code2', 'signal', 'exitRejection', 'initializeRejection', 'spawnException'] as const)(
    'retains a failed SDK root for 24 hours: %s',
    async (failure) => {
      const h = await fixture()
      const actual = await vi.importActual<typeof sdk>('@muse-code/sdk')
      const native = actual.spawnMspConnection({
        command: process.execPath,
        args: ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'],
        env: {},
        shutdownTimeoutMs: 1000,
      })
      const exit = Promise.withResolvers<sdk.ProcessExit>()
      vi.spyOn(native, 'exited', 'get').mockReturnValue(exit.promise)
      vi.mocked(sdk.spawnMspConnection).mockImplementation(() => {
        if (failure === 'spawnException') throw new Error('fixture spawn exception')
        return native
      })
      if (failure === 'initializeRejection')
        vi.spyOn(native, 'initialize').mockRejectedValue(new Error('fixture initialize rejection'))
      const read = vi.spyOn(fs, 'readFile')
      const originalRead = await vi.importActual<typeof fs>('node:fs/promises')
      read.mockImplementation((file, options) =>
        typeof file === 'string' && file.replaceAll('\\', '/').endsWith('/root')
          ? Promise.resolve('1')
          : originalRead.readFile(file, options),
      )
      try {
        const spawning = spawnResourceMuseConnection(
          { command: 'fixture', shutdownTimeoutMs: 1000 },
          h.lease,
          () => Promise.resolve('fixture.dll'),
          process.env['SystemRoot'],
          () => Promise.resolve(),
        )
        if (failure === 'spawnException')
          await expect(spawning).rejects.toThrow('fixture spawn exception')
        else {
          const handshake = await spawning
          if (failure === 'initializeRejection')
            await expect(
              handshake.initialize({ clientInfo: { name: 'fixture', version: 'test' } }),
            ).rejects.toThrow('fixture initialize rejection')
          if (failure === 'exitRejection') exit.reject(new Error('fixture exit rejection'))
          else
            exit.resolve(
              failure === 'signal'
                ? { code: null, signal: 'SIGTERM' }
                : { code: failure === 'code2' ? 2 : 0, signal: null },
            )
          await vi.waitFor(() => {
            expect(h.lease.complete).toHaveBeenCalledWith(false)
          })
        }
        await h.settle()
        expect(h.lease.failed).toHaveBeenCalled()
        expect(await readdir(h.registry.base)).toContain(path.basename(h.temp.root))
        expect(await h.registry.clean()).toMatchObject({ removed: 0 })
        h.advance()
        expect(await h.registry.clean()).toMatchObject({ removed: 1 })
      } finally {
        exit.resolve({ code: 0, signal: null })
        await native.close()
        await h.settle()
        await h.cleanup()
      }
    },
  )
})

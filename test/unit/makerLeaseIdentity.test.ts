// FIXM103W10 (PLAN M103): the hardware lease's holder identity on every
// platform, the Windows private-folder check and the bounded POSIX Stop
// socket; FIXM103W11 adds previous-build owners and Windows name casing.
// Real-OS cases run on their own platform; the parsers run everywhere
// against a fake process runner.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimHardwareLease, leaseIdentity, stopHardwareLease } from '../../src/core/maker/lease'
import type { RunProgram } from '../../src/host/processTree'
import { runtimeLeaseIdentity } from '../../src/runtime/maker/stop'
import { createRuntimeMakerService } from '../../src/runtime/maker/service'
import { withoutCredentials, withoutKeyringRoutes } from '../../src/runtime/credentialVariables'
import {
  MAKER_LEASE_SOCKET_NAME_CHARS,
  MAKER_LEASE_SOCKET_PATH_BYTES,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../src/shared/constants'
import { makerLeaseDeps, previousBuildOwner } from './helpers/makerSerial'
import { makePrivateFolder, makerTempRoot, runWindowsTool } from './helpers/makerTemp'

const MISSING_PID = 2 ** 31 - 1
const START_PATTERNS: Partial<Record<NodeJS.Platform, RegExp>> = {
  linux: /^\d+$/,
  win32: /^\d+$/,
  darwin: /^\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4}$/,
}
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
async function temporary(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(makerTempRoot(), prefix))
  directories.push(directory)
  return directory
}
function fakeRun(output: string | Error) {
  return vi.fn<RunProgram>(() =>
    output instanceof Error ? Promise.reject(output) : Promise.resolve(output),
  )
}
const powershell = { file: String.raw`C:\Windows\powershell.exe`, env: { SystemRoot: 'C:' } }

describe('lease holder start identity on this OS (FIXM103W10)', () => {
  it('reads one stable identity for this process and proves a missing pid absent', async () => {
    const identity = runtimeLeaseIdentity(process.platform, process.env)
    const own = await identity.processStartTime(process.pid)
    expect(own).toMatch(START_PATTERNS[process.platform] ?? /^$/)
    expect(await identity.processStartTime(process.pid)).toBe(own)
    expect(await identity.processStartTime(MISSING_PID)).toBeUndefined()
  })
  it('gives a child its own identity while it runs and none once it has exited', async () => {
    const identity = runtimeLeaseIdentity(process.platform, process.env)
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    const closed = new Promise<void>((resolve) => {
      child.once('close', () => {
        resolve()
      })
    })
    try {
      await new Promise<void>((resolve) => {
        child.once('spawn', () => {
          resolve()
        })
      })
      const pid = child.pid ?? MISSING_PID
      const start = await identity.processStartTime(pid)
      expect(start).toMatch(START_PATTERNS[process.platform] ?? /^$/)
      if (process.platform !== 'darwin')
        expect(start).not.toBe(await identity.processStartTime(process.pid))
      child.kill()
      await closed
      expect(await identity.processStartTime(pid)).toBeUndefined()
    } finally {
      child.kill()
      await closed
    }
  })
})

describe('lease holder start identity parsers (FIXM103W10)', () => {
  it('macOS: pins ps to the C locale and UTC and keeps lstart exactly', async () => {
    const run = fakeRun('Ss   Thu Oct  9 15:21:38 2026\n')
    const { processStartTime } = leaseIdentity({ platform: 'darwin', run })
    expect(await processStartTime(4242)).toBe('Thu Oct  9 15:21:38 2026')
    expect(run).toHaveBeenCalledExactlyOnceWith('/bin/ps', ['-o', 'stat=,lstart=', '-p', '4242'], {
      LC_ALL: 'C',
      TZ: 'UTC',
    })
  })
  it('macOS: a zombie holder is absent', async () => {
    const { processStartTime } = leaseIdentity({
      platform: 'darwin',
      run: fakeRun('Z    Thu Oct  9 15:21:38 2026\n'),
    })
    await expect(processStartTime(4242)).resolves.toBeUndefined()
  })
  it.each(['', 'garbage', 'Ss   9 Oct 2026 15:21:38', 'Ss\n'])(
    'macOS: unparseable ps output %j is unknown, never a match',
    async (output) => {
      const { processStartTime } = leaseIdentity({ platform: 'darwin', run: fakeRun(output) })
      await expect(processStartTime(4242)).rejects.toThrow('lease-stat-unparseable')
    },
  )
  it('macOS: a failed ps proves absence only by ESRCH; a live pid stays unknown', async () => {
    const failure = new Error('ps exited 1')
    const { processStartTime } = leaseIdentity({ platform: 'darwin', run: fakeRun(failure) })
    await expect(processStartTime(process.pid)).rejects.toBe(failure)
    await expect(processStartTime(MISSING_PID)).resolves.toBeUndefined()
  })
  it('Windows: reads the creation FILETIME the process tree compares; absent is absent', async () => {
    const run = fakeRun('134360343929763446\r\n')
    const { processStartTime } = leaseIdentity({ platform: 'win32', run, powershell })
    expect(await processStartTime(4242)).toBe('134360343929763446')
    const [file, args, env] = run.mock.calls[0] ?? []
    expect(file).toBe(powershell.file)
    expect(env).toBe(powershell.env)
    expect(args?.slice(0, -1)).toEqual([...WINDOWS_POWERSHELL_COMMAND_ARGS])
    expect(args?.at(-1)).toContain('GetProcessById(4242).StartTime.ToFileTimeUtc()')
    run.mockResolvedValueOnce('absent\r\n')
    await expect(processStartTime(4242)).resolves.toBeUndefined()
  })
  it.each(['', 'Exception calling "GetProcessById"', '-1', '12 34'])(
    'Windows: output %j is unknown, never a match',
    async (output) => {
      const { processStartTime } = leaseIdentity({
        platform: 'win32',
        run: fakeRun(output),
        powershell,
      })
      await expect(processStartTime(4242)).rejects.toThrow('lease-stat-unparseable')
    },
  )
  it('Windows: without SystemRoot every identity and owner answer is unknown', async () => {
    const run = fakeRun('True')
    const { processStartTime, isOwnerDirectory } = leaseIdentity({ platform: 'win32', run })
    await expect(processStartTime(4242)).rejects.toThrow('lease-identity-unavailable')
    await expect(isOwnerDirectory?.(String.raw`C:\leases`)).rejects.toThrow(
      'lease-identity-unavailable',
    )
    expect(run).not.toHaveBeenCalled()
    await expect(runtimeLeaseIdentity('win32', {}).processStartTime(process.pid)).rejects.toThrow(
      'lease-identity-unavailable',
    )
  })
  it('Windows: the owner check is private only on an exact True and quotes the folder', async () => {
    const run = fakeRun('True\r\n')
    const { isOwnerDirectory } = leaseIdentity({ platform: 'win32', run, powershell })
    expect(await isOwnerDirectory?.(String.raw`C:\Users\O’Brien's\leases`)).toBe(true)
    expect(run.mock.calls[0]?.[1].at(-1)).toContain(
      String.raw`GetAccessControl('C:\Users\O’’Brien''s\leases')`,
    )
    for (const output of ['False', '0', 'true', ''])
      expect(
        await leaseIdentity({
          platform: 'win32',
          run: fakeRun(output),
          powershell,
        }).isOwnerDirectory?.(String.raw`C:\leases`),
      ).toBe(false)
  })
})

describe.runIf(process.platform === 'win32')('Windows private lease folder (FIXM103W10)', () => {
  it('admits only the owner, SYSTEM and Administrators', async () => {
    const { isOwnerDirectory } = runtimeLeaseIdentity('win32', process.env)
    const folder = path.join(await temporary('m103w10-acl-'), 'leases')
    await makePrivateFolder(folder)
    expect(await isOwnerDirectory?.(folder)).toBe(true)
    await runWindowsTool('icacls.exe', [
      folder,
      '/grant',
      '*S-1-5-18:(OI)(CI)F',
      '/grant',
      '*S-1-5-32-544:(OI)(CI)F',
    ])
    expect(await isOwnerDirectory?.(folder)).toBe(true)
    await runWindowsTool('icacls.exe', [folder, '/grant', '*S-1-5-32-545:(R)'])
    expect(await isOwnerDirectory?.(folder)).toBe(false)
  })
  it('a missing folder is never private', async () => {
    const { isOwnerDirectory } = runtimeLeaseIdentity('win32', process.env)
    const folder = path.join(await temporary('m103w10-acl-'), 'missing')
    expect(await isOwnerDirectory?.(folder)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('POSIX Stop socket path (FIXM103W10)', () => {
  it("names a lease's Stop socket by the id's first characters, inside the private folder", async () => {
    const directory = path.join(await temporary('m103w10-sock-'), 'leases')
    const claim = await claimHardwareLease(
      await makerLeaseDeps(directory),
      'port:short',
      'test',
      () => Promise.resolve(),
    )
    if (claim.status !== 'acquired') throw new Error('claim')
    try {
      const { endpoint, id } = claim.record
      expect(endpoint).toBe(
        path.join(directory, `${id.slice(0, MAKER_LEASE_SOCKET_NAME_CHARS)}.sock`),
      )
      expect(Buffer.byteLength(endpoint)).toBeLessThanOrEqual(MAKER_LEASE_SOCKET_PATH_BYTES)
    } finally {
      await claim.release()
    }
  })
  it('refuses a Stop socket path over the cap before any lease file exists', async () => {
    const root = await temporary('m103w10-sock-')
    const directory = path.join(root, 'd'.repeat(MAKER_LEASE_SOCKET_PATH_BYTES - root.length))
    await mkdir(directory, { mode: 0o700 })
    await expect(
      claimHardwareLease(await makerLeaseDeps(directory), 'port:long', 'test', () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow('lease-endpoint-too-long')
    expect(await readdir(directory)).toEqual([])
  })
  it('RVM103W5 P1 still reaches an owner a previous build published under the whole-id socket', async () => {
    const directory = path.join(await temporary('m103w11-legacy-'), 'leases')
    await makePrivateFolder(directory)
    const deps = await makerLeaseDeps(directory)
    const owner = await previousBuildOwner(
      directory,
      'port:previous',
      (await deps.processStartTime(process.pid)) ?? '',
    )
    try {
      expect(await stopHardwareLease(deps, 'port:previous')).toEqual({
        stopped: true,
        sessions: [{ record: owner.record, party: 'holder', status: 'stopped' }],
      })
      expect(owner.requests).toEqual([{ command: 'stop', id: owner.record.id }])
      // A new claim sees the live previous owner, not an unknown record.
      const busy = await claimHardwareLease(deps, 'port:previous', 'test', () => Promise.resolve())
      expect(busy).toEqual({ status: 'busy', holder: owner.record })
    } finally {
      await owner.close()
    }
  })
})

describe('Windows environment names ignore case (FIXM103W11 RVM103W5 P2)', () => {
  it.each(['SystemRoot', 'SYSTEMROOT', 'systemroot'])(
    'finds %s and ProgramFiles in any spelling through the real sanitizers',
    async (name) => {
      const run = fakeRun('134360343929763446\r\n')
      const env = withoutKeyringRoutes(
        withoutCredentials(
          { [name]: String.raw`D:\Windows`, PROGRAMFILES: String.raw`E:\Apps`, GH_TOKEN: 'never' },
          [],
          'win32',
        ),
      )
      const identity = runtimeLeaseIdentity('win32', env, run)
      expect(await identity.processStartTime(4242)).toBe('134360343929763446')
      const [file, , childEnv] = run.mock.calls[0] ?? []
      expect(file).toBe(String.raw`D:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
      expect(childEnv?.['PSModulePath']).toBe(
        String.raw`E:\Apps\WindowsPowerShell\Modules;D:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
      )
      expect(childEnv).not.toHaveProperty('GH_TOKEN')
    },
  )
  it.runIf(process.platform === 'win32')(
    'a real Windows claim succeeds when the environment spells it SYSTEMROOT',
    async () => {
      const root = await temporary('m103w11-env-')
      const workspace = path.join(root, 'workspace')
      await mkdir(workspace)
      const service = await createRuntimeMakerService({
        dataDirectory: path.join(root, 'data'),
        workspace,
        trusted: () => true,
        flagged: () => true,
        interactive: () => true,
        presence: { check: vi.fn().mockResolvedValue('approved') },
        secrets: {
          get: () => Promise.resolve(undefined),
          store: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        },
        native: {
          platform: 'win32',
          env: { SYSTEMROOT: process.env['SystemRoot'], PATH: process.env['PATH'] },
          packageRoot: path.resolve('.'),
        },
      })
      try {
        await makePrivateFolder(path.join(root, 'data', 'maker', 'leases'))
        const claim = await claimHardwareLease(service.serial.lease, 'port:env', 'test', () =>
          Promise.resolve(),
        )
        expect(claim.status).toBe('acquired')
        if (claim.status === 'acquired') await claim.release()
      } finally {
        await service.close()
      }
    },
  )
})

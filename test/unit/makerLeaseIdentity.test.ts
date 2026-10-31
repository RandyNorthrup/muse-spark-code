// FIXM103W10 (PLAN M103): the hardware lease's holder identity on every
// platform, the Windows private-folder check and the bounded POSIX Stop
// socket; FIXM103W11 adds previous-build owners and Windows name casing.
// Real-OS cases run on their own platform.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claimHardwareLease, stopHardwareLease } from '../../src/core/maker/lease'
import { environmentValue, windowsPowerShell } from '../../src/core/execGuard'
import { runtimeLeaseIdentity } from '../../src/runtime/maker/stop'
import { withoutCredentials, withoutKeyringRoutes } from '../../src/runtime/credentialVariables'
import {
  MAKER_LEASE_SOCKET_NAME_CHARS,
  MAKER_LEASE_SOCKET_PATH_BYTES,
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
    (name) => {
      const env = withoutKeyringRoutes(
        withoutCredentials(
          { [name]: String.raw`D:\Windows`, PROGRAMFILES: String.raw`E:\Apps`, GH_TOKEN: 'never' },
          [],
          'win32',
        ),
      )
      const systemRoot = environmentValue(env, 'win32', 'SystemRoot')
      expect(systemRoot).toBe(String.raw`D:\Windows`)
      if (systemRoot === undefined) throw new Error('SystemRoot missing')
      const shell = windowsPowerShell(systemRoot, env)
      expect(shell.file).toBe(String.raw`D:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
      expect(shell.env['PSModulePath']).toBe(
        String.raw`E:\Apps\WindowsPowerShell\Modules;D:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
      )
      expect(shell.env).not.toHaveProperty('GH_TOKEN')
    },
  )
})

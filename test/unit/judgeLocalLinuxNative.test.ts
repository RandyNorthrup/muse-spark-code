import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  mkdtemp,
  readFile,
  chmod,
  realpath,
  rm,
  writeFile,
  readdir,
  readlink,
} from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLinuxPeerDependencies } from '../../src/core/judge/local/linuxPeer'
import { verifyLinuxInstallation } from '../../src/core/judge/local/linuxVolume'
import type { PosixProcessLease } from '../../src/core/judge/local/posixPeer'

const execute = promisify(execFile)
const rig = { helper: '' }
async function rejectedLease(helper: string, pid: number): Promise<unknown> {
  try {
    const lease = await createLinuxPeerDependencies(helper).acquireProcess(
      pid,
      new AbortController().signal,
    )
    await lease.close()
    return 'unexpected-native-success'
  } catch (error: unknown) {
    return error
  }
}
describe.skipIf(process.platform !== 'linux')('M98 Linux real pidfd lease', () => {
  beforeAll(async () => {
    // /tmp can be tmpfs; these proofs require real local block-device storage.
    const folder = await mkdtemp('/var/tmp/m98j3l-native-')
    rig.helper = path.join(folder, 'peer')
    await execute(
      '/usr/bin/cc',
      [
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-O2',
        path.resolve('native/linux/MuseSparkLocalJudgePeer.c'),
        '-o',
        rig.helper,
      ],
      { env: { PATH: '/usr/bin:/bin' } },
    )
    await chmod(rig.helper, 0o755)
  })
  afterAll(async () => {
    if (rig.helper) await rm(path.dirname(rig.helper), { recursive: true, force: true })
  })
  it('binds exact UID, executable and start time while retaining a native fd', async () => {
    const deps = createLinuxPeerDependencies(rig.helper)
    const lease = await deps.acquireProcess(process.pid, new AbortController().signal)
    try {
      const stat = await readFile(`/proc/${String(process.pid)}/stat`, 'utf8')
      const fields = stat
        .slice(stat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)
      const getUid = process.getuid
      expect(await lease.identity()).toEqual({
        pid: process.pid,
        uid: getUid?.(),
        creationTime: fields[19],
        executable: await realpath(process.execPath),
      })
      expect(await lease.isAlive()).toBe(true)
      const tasks = await readdir('/proc/self/task')
      const childLists = await Promise.all(
        tasks.map((tid) => readFile(`/proc/self/task/${tid}/children`, 'utf8')),
      )
      const childPids = new Set(
        childLists.flatMap((list) => list.trim().split(/\s+/)).filter((pid) => /^\d+$/.test(pid)),
      )
      let pidfds = 0
      for (const pid of childPids) {
        if ((await readlink(`/proc/${pid}/exe`)) !== rig.helper) continue
        const descriptors = await readdir(`/proc/${pid}/fd`)
        for (const fd of descriptors) {
          if ((await readlink(`/proc/${pid}/fd/${fd}`)) !== 'anon_inode:[pidfd]') continue
          pidfds++
          const fdinfo = await readFile(`/proc/${pid}/fdinfo/${fd}`, 'utf8')
          expect(fdinfo).toContain(`Pid:\t${String(process.pid)}\n`)
        }
      }
      expect(pidfds).toBe(1)
    } finally {
      await lease.close()
    }
    await expect(lease.identity()).rejects.toThrow('unverified-native-lifetime')
  })
  it('keeps a dead generation dead across a replacement process', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'process.title="ollama with spaces";setInterval(()=>{},1000)'],
      { env: {}, stdio: 'ignore' },
    )
    await once(child, 'spawn')
    if (!child.pid) throw new Error('missing test pid')
    const deps = createLinuxPeerDependencies(rig.helper)
    const exited = once(child, 'exit')
    let lease: PosixProcessLease
    try {
      lease = await deps.acquireProcess(child.pid, new AbortController().signal)
    } catch (error: unknown) {
      child.kill()
      await exited
      throw error
    }
    child.kill()
    await exited
    const replacement = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      env: {},
      stdio: 'ignore',
    })
    await once(replacement, 'spawn')
    try {
      expect(await lease.isAlive()).toBe(false)
      await expect(lease.identity()).rejects.toThrow('unverified-runtime-generation')
    } finally {
      await lease.close()
      const ended = once(replacement, 'exit')
      replacement.kill()
      await ended
    }
  })
  it('refuses a foreign real UID even when the numeric PID is visible', async () => {
    const getUid = process.getuid
    let child: ChildProcess | undefined
    if (getUid?.() === 0) {
      child = spawn('/bin/sleep', ['60'], { env: {}, stdio: 'ignore', uid: 65_534, gid: 65_534 })
      await once(child, 'spawn')
    }
    const pid = child?.pid ?? 1
    try {
      const outcome = await rejectedLease(rig.helper, pid)
      expect(outcome).toMatchObject({ message: 'unverified-native-lifetime' })
    } finally {
      if (child) {
        const exit = once(child, 'exit')
        child.kill()
        await exit
      }
    }
  })
  it.each(['extra', 'uid', 'pid', 'start'])(
    'validates native %s evidence before accepting a lease',
    async (fault) => {
      const file = path.join(path.dirname(rig.helper), 'invalid-frame')
      const getUid = process.getuid
      const uid = getUid?.()
      if (uid === undefined) throw new Error('missing native uid')
      const frame = {
        alive: true,
        identity: {
          pid: fault === 'pid' ? process.pid + 1 : process.pid,
          uid: fault === 'uid' ? uid + 1 : uid,
          executable: process.execPath,
          creationTime: fault === 'start' ? 'invalid' : '1',
        },
        ...(fault === 'extra' && { extra: true }),
      }
      await writeFile(
        file,
        `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(frame)}'\nwhile read -r line; do :; done\n`,
        { mode: 0o755 },
      )
      const outcome = await rejectedLease(file, process.pid)
      expect(outcome).toBeInstanceOf(Error)
    },
  )
  it('refuses absent processes, helper permissions and cancellation', async () => {
    const deps = createLinuxPeerDependencies(rig.helper)
    await expect(deps.acquireProcess(2_147_483_647, new AbortController().signal)).rejects.toThrow(
      'unverified-native-lifetime',
    )
    await chmod(rig.helper, 0o777)
    try {
      await expect(deps.acquireProcess(process.pid, new AbortController().signal)).rejects.toThrow(
        'unverified-installation',
      )
    } finally {
      await chmod(rig.helper, 0o755)
    }
    const controller = new AbortController()
    const lease = await deps.acquireProcess(process.pid, controller.signal)
    controller.abort()
    try {
      await expect(lease.identity()).rejects.toThrow()
    } finally {
      await lease.close()
    }
  })
  it('certifies actual local canonical fixture installation anchors', async () => {
    const getUid = process.getuid
    const uid = getUid?.()
    if (uid === undefined) throw new Error('missing test uid')
    await expect(
      verifyLinuxInstallation(
        {
          platform: 'linux',
          uid,
          executable: rig.helper,
          executableDigest: createHash('sha256')
            .update(await readFile(rig.helper))
            .digest('hex'),
          modelDirectory: path.dirname(rig.helper),
        },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined()
  })
})

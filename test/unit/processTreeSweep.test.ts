// The orphan sweep over a real process table: a group that is gone
// ends quietly instead of failing, and nothing runs without a group.

import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { sweepExitedTree, type ProcessTreeDeps } from '../../src/host/processTree'
import { collectingLogger as logger } from './helpers/collectingLogger'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

const deadGroup = 4_194_304

function sweepDeps(messages: string[]): ProcessTreeDeps {
  return {
    platform: 'linux',
    systemRoot: undefined,
    log: logger(messages).warn,
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killBestEffort(child: ChildProcess | undefined): void {
  try {
    child?.kill('SIGKILL')
  } catch {
    // Already gone: the sweep under test reaped it.
  }
}

describe('sweepExitedTree', () => {
  // A missing POSIX group answers ESRCH; Windows answers its own miss.
  it.runIf(process.platform !== 'win32')(
    'ends quietly when the group is already gone',
    async () => {
      const messages: string[] = []
      await sweepExitedTree(deadGroup, Date.now(), Date.now(), sweepDeps(messages))
      expect(messages).toHaveLength(0)
    },
  )

  it('resolves at once without a group', async () => {
    const messages: string[] = []
    await sweepExitedTree(undefined, Date.now(), Date.now(), sweepDeps(messages))
    expect(messages).toHaveLength(0)
  })

  // No round count of ours (D121, RLF-NOLIMITS): a fired stop ends the
  // sweep before its first round, on every platform — the check precedes
  // every platform branch, so a live child survives and the words name it.
  it('leaves a live child alone when the stop already fired', async () => {
    const messages: string[] = []
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    try {
      const pid = child.pid
      expect(pid).toBeDefined()
      if (pid === undefined) throw new Error('sweepStopTestSpawnFailed')
      const stop = new AbortController()
      stop.abort()
      await sweepExitedTree(
        pid,
        Date.now(),
        Date.now(),
        {
          platform: process.platform,
          systemRoot: process.platform === 'win32' ? process.env.SystemRoot : undefined,
          log: logger(messages).warn,
        },
        undefined,
        stop.signal,
      )
      expect(isAlive(pid)).toBe(true)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain(String(pid))
    } finally {
      killBestEffort(child)
    }
  })

  // The live stop still sweeps: an exited POSIX leader's group member is
  // signalled, so the stop path above is the only early end.
  it.runIf(process.platform !== 'win32')(
    'signals a live POSIX group when the stop is live',
    async () => {
      const messages: string[] = []
      const root = await temporaryDir('muse-sweep-stop-')
      let leader: ChildProcess | undefined
      try {
        leader = spawn('sh', ['-c', `sleep 30 & echo $! > "${root}/member.pid"; wait`], {
          detached: true,
          stdio: 'ignore',
        })
        const leaderPid = leader.pid
        expect(leaderPid).toBeDefined()
        if (leaderPid === undefined) throw new Error('sweepStopTestSpawnFailed')
        let memberPid = 0
        for (let attempt = 0; memberPid === 0 && attempt < 50; attempt += 1) {
          await delay(20)
          try {
            memberPid = Math.trunc(Number(await readFile(`${root}/member.pid`, 'utf8')))
          } catch {
            // The leader has not written its member's pid yet.
          }
        }
        expect(memberPid).toBeGreaterThan(0)
        leader.kill('SIGKILL')
        await delay(200)
        expect(isAlive(memberPid)).toBe(true)
        await sweepExitedTree(leaderPid, Date.now(), Date.now(), sweepDeps(messages))
        let isReaped = false
        for (let attempt = 0; !isReaped && attempt < 50; attempt += 1) {
          await delay(20)
          isReaped = !isAlive(memberPid)
        }
        expect(isReaped).toBe(true)
      } finally {
        killBestEffort(leader)
        await removeFolder(root)
      }
    },
  )
})

// LOCKLIB's test ports (M123, PLAN.md M123's lock protocol), shared by the
// lease's own suite and the pull request records and checkout suites: node's
// lease port with one-shot pauses or failing listings, and the small waits
// an interleaving test needs.

import { spawn } from 'node:child_process'
import type { LeasePort } from '../../../src/core/locks/fileLease'
import { nodeLeasePort } from '../../../src/core/locks/nodeLeasePort'

interface Pause {
  /** Settles when the paused call is reached, before it runs. */
  readonly reached: Promise<void>
  readonly resume: () => void
}

type AsyncOp =
  'mkdir' | 'readdir' | 'readFile' | 'createExclusive' | 'link' | 'rename' | 'unlink' | 'lstat'

/** A record generation's file name. */
export const GENERATION_FILE = /\d+\.json$/u

/** Node's lease port (or `base`), with one-shot pauses a test arms per call. */
export function pausingPort(base: LeasePort = nodeLeasePort) {
  const traps: {
    readonly op: AsyncOp
    readonly isMatch: (args: readonly string[]) => boolean
    readonly hit: () => void
    readonly gate: Promise<void>
  }[] = []
  const pass = async (op: AsyncOp, args: readonly string[]): Promise<void> => {
    const index = traps.findIndex((trap) => trap.op === op && trap.isMatch(args))
    const trap = traps[index]
    if (trap === undefined) {
      return
    }
    traps.splice(index, 1)
    trap.hit()
    await trap.gate
  }
  const port: LeasePort = {
    ...base,
    mkdir: async (folder) => {
      await pass('mkdir', [folder])
      await base.mkdir(folder)
    },
    readdir: async (folder) => {
      await pass('readdir', [folder])
      return await base.readdir(folder)
    },
    readFile: async (file) => {
      await pass('readFile', [file])
      return await base.readFile(file)
    },
    createExclusive: async (file, content, durability) => {
      await pass('createExclusive', [file, content])
      await base.createExclusive(file, content, durability)
    },
    link: async (existing, target) => {
      await pass('link', [existing, target])
      await base.link(existing, target)
    },
    rename: async (from, to) => {
      await pass('rename', [from, to])
      await base.rename(from, to)
    },
    unlink: async (file) => {
      await pass('unlink', [file])
      await base.unlink(file)
    },
    lstat: async (file) => {
      await pass('lstat', [file])
      return await base.lstat(file)
    },
  }
  const pauseAt = (op: AsyncOp, isMatch: (args: readonly string[]) => boolean): Pause => {
    const reached = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    traps.push({
      op,
      isMatch,
      hit: () => {
        reached.resolve(undefined)
      },
      gate: gate.promise,
    })
    return {
      reached: reached.promise,
      resume: () => {
        gate.resolve(undefined)
      },
    }
  }
  return { port, pauseAt }
}

/**
 * Node's lease port, failing chosen listings (`failureCode`), counted from
 * the first generation published after `arm()`: 1 is that publish's own
 * proof, 2 the sweep after it (or, unproven, the reconciliation read).
 */
export function failingListingsAfterLink(failing: readonly number[], failureCode = 'EACCES') {
  let isArmed = false
  let listings: number | undefined
  let failed = 0
  const fs: LeasePort = {
    ...nodeLeasePort,
    link: async (existing, target) => {
      await nodeLeasePort.link(existing, target)
      if (!isArmed || !GENERATION_FILE.test(target)) {
        return
      }
      isArmed = false
      listings = 0
    },
    readdir: async (folder) => {
      if (listings !== undefined) {
        listings += 1
        if (failing.includes(listings)) {
          failed += 1
          throw Object.assign(new Error(`EACCES: permission denied, scandir '${folder}'`), {
            code: failureCode,
          })
        }
      }
      return await nodeLeasePort.readdir(folder)
    },
  }
  return {
    fs,
    arm: () => {
      isArmed = true
    },
    failed: () => failed,
  }
}

/** Something to resolve from outside: a step a test waits for. */
export function deferred(): { readonly promise: Promise<undefined>; readonly resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<undefined>()
  return {
    promise,
    resolve: () => {
      resolve(undefined)
    },
  }
}

/** One turn of the event loop: other holders' steps run in it. */
export async function nextTurn(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/** The id of a process that has exited: provably gone on this host. */
export async function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true })
  await new Promise((resolve) => {
    child.once('exit', resolve)
  })
  if (child.pid === undefined) {
    throw new Error('the process never started')
  }
  return child.pid
}

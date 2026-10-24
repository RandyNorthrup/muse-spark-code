// `muse-spark-code-acp stop` (M104 lane H): every supervised run started in
// this folder is asked to stop through its own private endpoint, with its
// token, and answers once its whole tree is gone. The caller's own run (a
// stop from inside a supervised language server) is asked last, so the
// others are stopped before this process ends with its own. A record whose
// endpoint no longer answers belonged to a run that ended without cleaning
// up: it is removed once that is certain.
import { createConnection } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { isErrno } from '../../core/fs/errno'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { Logger } from '../../host/logger'
import {
  POSIX_TREE_EXIT_POLL_MS,
  SUPERVISE_MESSAGE_MAX_BYTES,
  SUPERVISE_REPLY,
  TREE_EXIT_WAIT_MS,
} from '../../shared/constants'
import { folderRecords, removeRecord, type SupervisedRecord } from './records'
import { access } from 'node:fs/promises'

export interface StopDeps {
  /** The verified owner-only folder the records live in. */
  readonly root: string
  /** The folder whose runs stop. */
  readonly cwd: string
  /** The caller's own run, when it is itself supervised: stopped last. */
  readonly ownOwner: string | undefined
  readonly log: Logger
}

export interface StopOutcome {
  readonly stopped: number
  /** Runs that answered but could not prove their tree gone, and unusable records. */
  readonly failed: number
}

type Answer = 'stopped' | 'failed' | 'gone'

/** One run's answer through its endpoint; `gone` when nothing listens there any more. */
function askToStop(record: SupervisedRecord): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(record.endpoint)
    let reply = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => {
      socket.write(`${record.token}\n`)
    })
    socket.on('data', (chunk: string) => {
      reply += chunk
      if (Buffer.byteLength(reply) > SUPERVISE_MESSAGE_MAX_BYTES) socket.destroy()
    })
    socket.once('error', (error: Error) => {
      // Nothing listens: the run ended (a stale socket refuses, a pipe is gone).
      if (isErrno(error) && (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')) {
        resolve('gone')
        return
      }
      reject(error)
    })
    socket.once('close', (hadError) => {
      if (hadError) return
      resolve(reply === `${SUPERVISE_REPLY.stopped}\n` ? 'stopped' : 'failed')
    })
  })
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch (error: unknown) {
    if (isErrno(error) && error.code === 'ENOENT') return false
    throw error
  }
}

/**
A run that no longer answers closes its endpoint just before it removes
its record; one whose record outlives that is gone without cleanup.
*/
async function settleGone(file: string): Promise<void> {
  const deadline = Date.now() + TREE_EXIT_WAIT_MS
  while (await isPresent(file)) {
    if (Date.now() >= deadline) {
      await removeRecord(file)
      return
    }
    await delay(POSIX_TREE_EXIT_POLL_MS)
  }
}

export async function stopSupervised(deps: StopDeps): Promise<StopOutcome> {
  const found = await folderRecords(deps.root, deps.cwd)
  // The caller's own run last: stopping it ends this process too.
  const ordered = found.toSorted(
    (left, right) =>
      Number(left.record?.ownerId === deps.ownOwner) -
      Number(right.record?.ownerId === deps.ownOwner),
  )
  let stopped = 0
  let failed = 0
  for (const { file, record } of ordered) {
    if (record === undefined) {
      deps.log.warn('A supervised run record is unusable and was left in place')
      failed += 1
      continue
    }
    let answer: Answer
    try {
      answer = await askToStop(record)
    } catch (error: unknown) {
      deps.log.warn(`A supervised run could not be asked to stop: ${failureForLog(error)}`)
      failed += 1
      continue
    }
    if (answer === 'gone') await settleGone(file)
    else if (answer === 'stopped') stopped += 1
    else failed += 1
  }
  return { stopped, failed }
}

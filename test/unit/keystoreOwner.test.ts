// One owner per credential account, across processes (RVHOSTID R1 and R5):
// the real keyringSecretStore over the real OS credential store, in real
// child processes, on throwaway accounts and a throwaway lock scope. Nothing
// is replaced. Every case fails when a person would be hurt: a successful
// write that cannot be read back, a secret part left behind after a delete or
// a crash, a reader that meets a deleted generation.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KEYRING_PART_CHARS, KEYRING_SERVICE } from '../../src/shared/constants'

const isWindows = process.platform === 'win32'
const scratch = { folder: '', bundle: '' }
const accounts: string[] = []
const scopes = new Set<string>()
// How long a paused process is left paused while another waits for its account.
const WAIT_FOR_OWNER_MS = 1500

beforeAll(async () => {
  const temp = path.resolve('temp')
  scratch.folder = await mkdtemp(path.join(temp, 'keystore-owner-'))
  scratch.bundle = path.join(scratch.folder, 'keystore.cjs')
  await build({
    entryPoints: [path.resolve('src/runtime/keyStore.ts')],
    outfile: scratch.bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
})

afterAll(async () => {
  const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring')
  for (const scope of scopes) {
    const service = `${KEYRING_SERVICE}.test.${scope}`
    const found = await findCredentialsAsync(service)
    for (const entry of found) {
      if (accounts.some((account) => entry.account.startsWith(account))) {
        await new AsyncEntry(service, entry.account).deletePassword()
      }
    }
  }
  if (scratch.folder !== '') await rm(scratch.folder, { recursive: true, force: true })
})

/** A throwaway account name; every entry the test makes begins with it. */
function account(): string {
  const name = `museSpark.test.keystoreOwner.${randomUUID()}`
  accounts.push(name)
  return name
}

/** A long value with real structure, so a wrong part or a wrong order cannot hash the same. */
function longValue(seed: string, length: number): string {
  let value = ''
  while (value.length < length) value += `${seed}:${randomUUID()};`
  return value.slice(0, length)
}

interface Reply {
  readonly ok?: boolean
  readonly value?: string | null
  readonly error?: string
  readonly calls?: number
  readonly paused?: string
}

/** The scheduling the worker adds to its OS calls (see test/hosts/keystore-worker.mjs). */
interface Schedule {
  readonly dieAt?: number
  readonly pauseBeforeHeader?: boolean
  readonly pauseAfterHeader?: boolean
  readonly resumeFile?: string
}

interface Ended {
  readonly done: true
  readonly value: undefined
}

class Worker {
  private readonly child: ChildProcess
  private readonly lines: AsyncIterator<string>
  private readonly ended: Promise<Ended>

  public constructor(scope: string, schedule: Schedule = {}) {
    scopes.add(scope)
    this.child = spawn(
      process.execPath,
      [
        path.resolve('test/hosts/keystore-worker.mjs'),
        scratch.bundle,
        scope,
        JSON.stringify(schedule),
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { SystemRoot: process.env['SystemRoot'], PATH: process.env['PATH'] },
      },
    )
    const output = this.child.stdout
    if (output === null) throw new Error('worker has no output')
    this.lines = createInterface({ input: output })[Symbol.asyncIterator]()
    this.ended = new Promise<Ended>((resolve) => {
      this.child.once('exit', () => {
        resolve({ done: true, value: undefined })
      })
    })
  }

  /** Sends a command without reading what comes back (a pause announces itself first). */
  public send(command: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify(command)}\n`)
  }

  public async ask(command: Record<string, unknown>): Promise<Reply> {
    this.send(command)
    return await this.answer()
  }

  /** The worker's next line: an answer, or a pause it announces. */
  public async answer(): Promise<Reply> {
    const next = await Promise.race([this.lines.next(), this.ended])
    if (next.done === true) throw new Error('worker ended')
    return JSON.parse(next.value) as Reply
  }

  public close(): void {
    this.child.stdin?.end()
    this.child.kill()
  }
}

/** An answer that must be a success; a failure names the worker's own error. */
async function succeeded(pending: Promise<Reply>, where = 'the call'): Promise<Reply> {
  const reply = await pending
  expect(reply.ok, `${where}: ${reply.error ?? 'no error named'}`).toBe(true)
  return reply
}

/** Every entry of the test's service that belongs to an account (the header, a record, a part). */
async function entriesOf(scope: string, name: string): Promise<string[]> {
  const { findCredentialsAsync } = await import('@napi-rs/keyring')
  const found = await findCredentialsAsync(`${KEYRING_SERVICE}.test.${scope}`)
  const mine = found
    .map((entry) => entry.account)
    .filter((entry) => entry === name || entry.startsWith(`${name}#`))
  return mine.toSorted((first, second) => first.localeCompare(second))
}

/**
 * What an R1 interleaving needs: its own lock scope and throwaway account, the
 * file whose existence resumes a paused process, and the two long values it
 * races (different lengths, so no part lines up).
 */
function raceSetup() {
  return {
    scope: randomUUID().slice(0, 16),
    name: account(),
    resumeFile: path.join(scratch.folder, `resume-${randomUUID()}`),
    x: longValue('X', KEYRING_PART_CHARS * 2 + 9),
    y: longValue('Y', KEYRING_PART_CHARS * 3 + 4),
  }
}

/**
 * The next owner of an account, as a fresh process: it optionally writes
 * `rewrite`, then deletes the account, so what a killed owner left is found
 * and removed by the owner's own reclamation.
 */
async function nextOwnerDeletes(scope: string, name: string, rewrite?: string): Promise<void> {
  const owner = new Worker(scope)
  try {
    if (rewrite !== undefined) {
      await succeeded(owner.ask({ op: 'store', account: name, value: rewrite }), 'next owner write')
    }
    await succeeded(owner.ask({ op: 'delete', account: name }), 'next owner delete')
  } finally {
    owner.close()
  }
}

/** The store as a fresh process sees it. */
async function readFresh(scope: string, name: string): Promise<Reply> {
  const worker = new Worker(scope)
  try {
    return await worker.ask({ op: 'get', account: name })
  } finally {
    worker.close()
  }
}

describe.runIf(isWindows)('one owner per credential account (R1, R5), real Windows store', () => {
  it('keeps a long value readable when two processes write the same account at once', async () => {
    const scope = randomUUID().slice(0, 16)
    const name = account()
    const first = new Worker(scope)
    const second = new Worker(scope)
    try {
      const a = longValue('writer-A', KEYRING_PART_CHARS * 3)
      const b = longValue('writer-B', KEYRING_PART_CHARS * 2 + 7)
      for (let round = 0; round < 4; round += 1) {
        await Promise.all([
          succeeded(first.ask({ op: 'store', account: name, value: a }), 'writer A'),
          succeeded(second.ask({ op: 'store', account: name, value: b }), 'writer B'),
        ])
        // Whichever write was last, the account reads as exactly one of them.
        const read = await succeeded(readFresh(scope, name), 'read after the race')
        expect([a, b]).toContain(read.value)
      }
      // No part outlives its generation: the header, and the parts it names.
      const header = await succeeded(readFresh(scope, name))
      const parts = Math.ceil((header.value ?? '').length / KEYRING_PART_CHARS)
      expect(await entriesOf(scope, name)).toHaveLength(1 + parts)
      await succeeded(first.ask({ op: 'delete', account: name }), 'delete')
      const absent = await succeeded(readFresh(scope, name), 'read after delete')
      expect(absent.value).toBeNull()
      expect(await entriesOf(scope, name)).toEqual([])
    } finally {
      first.close()
      second.close()
    }
  }, 120_000)

  it('never shows a reader a deleted generation while writers replace the value', async () => {
    const scope = randomUUID().slice(0, 16)
    const name = account()
    const writer = new Worker(scope)
    const reader = new Worker(scope)
    try {
      const values = [
        longValue('v1', KEYRING_PART_CHARS * 2 + 5),
        longValue('v2', KEYRING_PART_CHARS * 3),
        longValue('v3', KEYRING_PART_CHARS + 90),
      ]
      await succeeded(writer.ask({ op: 'store', account: name, value: values[0] }), 'first write')
      const state = { isWriting: true }
      const writing = (async () => {
        for (let round = 0; round < 12; round += 1) {
          await succeeded(
            writer.ask({ op: 'store', account: name, value: values[round % values.length] }),
            `write ${String(round)}`,
          )
        }
        state.isWriting = false
      })()
      const seen: Reply[] = []
      while (state.isWriting) seen.push(await reader.ask({ op: 'get', account: name }))
      await writing
      expect(seen.length).toBeGreaterThan(0)
      for (const reply of seen) {
        expect(reply.ok, reply.error ?? 'a read failed').toBe(true)
        expect(values).toContain(reply.value)
      }
      await succeeded(writer.ask({ op: 'delete', account: name }), 'delete')
      expect(await entriesOf(scope, name)).toEqual([])
    } finally {
      writer.close()
      reader.close()
    }
  }, 180_000)

  it('R1: a writer paused before its header cannot be overtaken into a header whose parts are gone', async () => {
    const { scope, name, resumeFile, x, y } = raceSetup()
    const slow = new Worker(scope, { pauseBeforeHeader: true, resumeFile })
    const quick = new Worker(scope)
    try {
      // Writer A writes X's parts, then stops just before it publishes X's header.
      slow.send({ op: 'store', account: name, value: x })
      const paused = await slow.answer()
      expect(paused.paused).toBe('before-header-write')
      // Writer B writes Y over the same account while A is paused. B waits for
      // the account's owner: it cannot publish until A is done.
      const second = quick.ask({ op: 'store', account: name, value: y })
      await delay(WAIT_FOR_OWNER_MS)
      // A resumes, publishes X and finishes; then B publishes Y.
      await writeFile(resumeFile, '')
      await succeeded(slow.answer(), 'writer A after its pause')
      await succeeded(second, 'writer B')
      // The account reads as the last write, whole. Before the owner it read as damage.
      const read = await succeeded(readFresh(scope, name), 'read after both writers')
      expect(read.value).toBe(y)
      await succeeded(quick.ask({ op: 'delete', account: name }), 'delete')
      expect(await entriesOf(scope, name)).toEqual([])
    } finally {
      await writeFile(resumeFile, '')
      slow.close()
      quick.close()
    }
  }, 120_000)

  it('R1: a reader that holds a header is never handed parts a replacement deleted', async () => {
    const { scope, name, resumeFile, x, y } = raceSetup()
    const writer = new Worker(scope)
    const reader = new Worker(scope, { pauseAfterHeader: true, resumeFile })
    try {
      await succeeded(writer.ask({ op: 'store', account: name, value: x }), 'first write')
      // The reader reads X's header, then stops with it in hand.
      reader.send({ op: 'get', account: name })
      const paused = await reader.answer()
      expect(paused.paused).toBe('after-header-read')
      // A replacement writes Y and removes X's parts while the reader waits.
      const replacing = writer.ask({ op: 'store', account: name, value: y })
      await delay(WAIT_FOR_OWNER_MS)
      await writeFile(resumeFile, '')
      // The reader returns a whole generation, X or Y; it never throws for a deleted one.
      const read = await succeeded(reader.answer(), 'the paused reader')
      await succeeded(replacing, 'the replacement')
      expect([x, y]).toContain(read.value)
      await succeeded(writer.ask({ op: 'delete', account: name }), 'delete')
      expect(await entriesOf(scope, name)).toEqual([])
    } finally {
      await writeFile(resumeFile, '')
      writer.close()
      reader.close()
    }
  }, 120_000)

  it('leaves nothing behind and keeps a readable value when a writer is killed at each OS call', async () => {
    const scope = randomUUID().slice(0, 16)
    const old = longValue('old', KEYRING_PART_CHARS * 2 + 3)
    const fresh = longValue('new', KEYRING_PART_CHARS * 3 + 11)
    // The OS calls one process makes: a seeding write, then the replacing write.
    // A process counts its own calls, so the sweep runs one process per kill point
    // and measures the total first on a live one.
    const measuring = new Worker(scope)
    const measuredName = account()
    let seedCalls: number
    let total: number
    try {
      const seeded = await succeeded(
        measuring.ask({ op: 'store', account: measuredName, value: old }),
        'seed',
      )
      seedCalls = seeded.calls ?? 0
      const replaced = await succeeded(
        measuring.ask({ op: 'store', account: measuredName, value: fresh }),
        'replace',
      )
      total = replaced.calls ?? 0
      await succeeded(measuring.ask({ op: 'delete', account: measuredName }), 'delete')
    } finally {
      measuring.close()
    }
    expect(total - seedCalls).toBeGreaterThan(8)
    // Every OS call of the replacing write is a kill point: the process seeds the
    // account, then is killed at that call of its own count.
    for (let at = seedCalls + 1; at <= total; at += 1) {
      const name = account()
      const doomed = new Worker(scope, { dieAt: at })
      try {
        await succeeded(doomed.ask({ op: 'store', account: name, value: old }), 'seed')
        await expect(doomed.ask({ op: 'store', account: name, value: fresh })).rejects.toThrow(
          'worker ended',
        )
      } finally {
        doomed.close()
      }
      // Whatever step the process died at, the value reads as the old one or
      // the new one, never as damage.
      const read = await succeeded(readFresh(scope, name), `read, killed at call ${String(at)}`)
      expect([old, fresh], `killed at call ${String(at)}`).toContain(read.value)
      // A read is an owner too: it must reclaim the killed writer's record
      // and every unpublished generation, without waiting for another write.
      const parts = Math.ceil((read.value ?? '').length / KEYRING_PART_CHARS)
      expect(await entriesOf(scope, name), `read recovery at call ${String(at)}`).toHaveLength(
        1 + parts,
      )
      await nextOwnerDeletes(scope, name, fresh)
      expect(await entriesOf(scope, name), `killed at call ${String(at)}`).toEqual([])
    }
  }, 600_000)

  it('leaves no part of a first write that is killed before its header', async () => {
    const scope = randomUUID().slice(0, 16)
    const value = longValue('first', KEYRING_PART_CHARS * 3 + 1)
    for (const at of [3, 4, 5, 6]) {
      const name = account()
      const doomed = new Worker(scope, { dieAt: at })
      try {
        await expect(doomed.ask({ op: 'store', account: name, value })).rejects.toThrow(
          'worker ended',
        )
      } finally {
        doomed.close()
      }
      // Even an absent-value read must recover the first writer's orphaned
      // parts. There may never be another write or delete on this account.
      const read = await succeeded(readFresh(scope, name), 'read after a failed first write')
      expect(read.value).toBeNull()
      expect(await entriesOf(scope, name)).toEqual([])
      await nextOwnerDeletes(scope, name)
      expect(await entriesOf(scope, name), `killed at call ${String(at)}`).toEqual([])
    }
  }, 300_000)
})

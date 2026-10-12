// RVCM109JD P2-1: a killed epoch publisher must not cost the next starter
// its session. Real publisher/starters processes, real kernel mutex and
// guardians, real native identity: no mocks, no sockets.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import * as z from 'zod/mini'
import { vaultPeerExecutable, vaultProcessIdentity } from '../../../src/runtime/vault/posixNative'
import { bumpVaultEpoch } from '../../../src/runtime/vault/epochContender'
import { UnixVaultPrivateFiles } from '../../../src/core/vault/broker/files'
import { vaultEpochWriterPath } from '../../../src/core/vault/broker/epoch'
import { UI_TEXT } from '../../../src/shared/constants'

vi.mock(
  '../../../src/core/resources/launcher',
  async () => await import('../helpers/vault/brokerChildLauncher'),
)

const messageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stage'), stage: z.string() }),
  z.strictObject({ kind: z.literal('complete'), value: z.number() }),
  z.strictObject({ kind: z.literal('refused'), reason: z.string() }),
])
const fixture = { directory: '', file: '', helper: '' }
/** First stdout line of a fixture child, parsed against the reply schema. */
function readReply(child: ChildProcess): Promise<z.infer<typeof messageSchema>> {
  let pending = ''
  return new Promise<z.infer<typeof messageSchema>>((resolve, reject) => {
    child.once('error', reject)
    child.stdout?.on('data', (bytes: Buffer) => {
      pending += bytes.toString()
      const end = pending.indexOf('\n')
      if (end === -1) return
      try {
        resolve(messageSchema.parse(JSON.parse(pending.slice(0, end).trim())))
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('invalid fixture reply'))
      }
    })
  })
}
function run(runDirectory: string, action: 'publish' | 'start', stage?: string) {
  const argv = [fixture.file, runDirectory, fixture.helper, action]
  if (stage !== undefined) argv.push(stage)
  const child = spawn(process.execPath, argv, { env: {}, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.resume()
  const exited = once(child, 'exit')
  return { child, exited, message: readReply(child) }
}

describe.skipIf(process.platform === 'win32')('POSIX epoch crash recovery', () => {
  beforeAll(async () => {
    fixture.directory = await mkdtemp(path.join(os.tmpdir(), 'vek-'))
    const root = await mkdtemp(path.join(fixture.directory, 'native-'))
    fixture.helper = vaultPeerExecutable(root)
    await mkdir(path.dirname(fixture.helper), { recursive: true })
    execFileSync('/usr/bin/cc', [
      '-Os',
      '-Wall',
      '-Wextra',
      '-Werror',
      'native/posix/vaultPeer.c',
      '-o',
      fixture.helper,
    ])
    fixture.file = path.join(fixture.directory, 'child.cjs')
    await build({
      entryPoints: ['test/unit/helpers/vault/epochCrashChild.ts'],
      outfile: fixture.file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      plugins: [
        {
          // The fixture child has no governor window: spawn the real helper
          // binaries directly, exactly like the in-process suites.
          name: 'direct-launcher',
          setup(builder) {
            builder.onResolve({ filter: /\/launcher$/ }, () => ({
              path: path.resolve('test/unit/helpers/vault/brokerChildLauncher.ts'),
            }))
          },
        },
      ],
    })
  })
  afterAll(async () => {
    if (fixture.directory) await rm(fixture.directory, { recursive: true, force: true })
  })
  it('a live writer is awaited, then refused with the fixed reason, and the session retries', async () => {
    const directory = await mkdtemp(path.join(fixture.directory, 'live-'))
    try {
      const files = new UnixVaultPrivateFiles()
      await files.directory(directory)
      const identity = await vaultProcessIdentity(fixture.helper, process.pid)
      if (identity === null) throw new Error('test process disappeared')
      const self = { processId: identity.processId, startedAt: identity.startedAt }
      // A suspended holder: claimed writer, live process, free mutex.
      const record = Buffer.from(JSON.stringify({ v: 1, ...self }))
      const held = await files.claim(vaultEpochWriterPath(directory), record)
      let refused: unknown = null
      try {
        await bumpVaultEpoch(fixture.helper, directory, files, self)
      } catch (error: unknown) {
        refused = error
      }
      try {
        expect(refused).toMatchObject({ message: UI_TEXT.vault.noAccess })
        expect(refused).not.toMatchObject({ code: 'EEXIST' })
      } finally {
        // The holder unwinds (its guardian loss already failed its authorize).
        await held()
      }
      await expect(bumpVaultEpoch(fixture.helper, directory, files, self)).resolves.toBe(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('a dead writer is replaced atomically and the next starter publishes', async () => {
    const directory = await mkdtemp(path.join(fixture.directory, 'dead-'))
    const sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: {},
      stdio: 'ignore',
    })
    const exited = once(sleeper, 'exit')
    try {
      await once(sleeper, 'spawn')
      if (sleeper.pid === undefined) throw new Error('missing sleeper')
      const ghost = await vaultProcessIdentity(fixture.helper, sleeper.pid)
      if (ghost === null) throw new Error('sleeper disappeared')
      sleeper.kill('SIGKILL')
      await exited
      // The killed publisher's writer remnant names a provably gone holder:
      // the bytes stand with no open handle, as a crash leaves them.
      const files = new UnixVaultPrivateFiles()
      await files.directory(directory)
      const record = Buffer.from(
        JSON.stringify({ v: 1, processId: ghost.processId, startedAt: ghost.startedAt }),
      )
      await writeFile(vaultEpochWriterPath(directory), record, { mode: 0o600 })
      const identity = await vaultProcessIdentity(fixture.helper, process.pid)
      if (identity === null) throw new Error('test process disappeared')
      const self = { processId: identity.processId, startedAt: identity.startedAt }
      await expect(bumpVaultEpoch(fixture.helper, directory, files, self)).resolves.toBe(1)
      const epoch = JSON.parse(await readFile(path.join(directory, 'lock-epoch.v1'), 'utf8'))
      expect(epoch).toEqual({ v: 1, epoch: 1 })
    } finally {
      sleeper.kill('SIGKILL')
      await exited
      await rm(directory, { recursive: true, force: true })
    }
  })
  it.each([
    { stage: 'mutex-acquired', published: false },
    { stage: 'writer-claimed', published: false },
    { stage: 'epoch-read', published: false },
    { stage: 'epoch-written', published: true },
    { stage: 'writer-released', published: true },
  ])(
    'SIGKILL during publish at $stage, then two starters: one epoch each, none lost',
    async ({ stage, published }) => {
      const runDirectory = await mkdtemp(path.join(fixture.directory, 'case-'))
      let held: ReturnType<typeof run> | undefined
      let first: ReturnType<typeof run> | undefined
      let second: ReturnType<typeof run> | undefined
      try {
        held = run(runDirectory, 'publish', stage)
        expect(await held.message).toEqual({ kind: 'stage', stage })
        held.child.kill('SIGKILL')
        expect(await held.exited).toEqual([null, 'SIGKILL'])
        held = undefined
        const base = published ? 1 : 0
        first = run(runDirectory, 'start')
        second = run(runDirectory, 'start')
        const [a, b] = await Promise.all([first.message, second.message])
        const values = [a, b].map((reply) => {
          expect(reply.kind).toBe('complete')
          if (reply.kind !== 'complete') throw new Error('starter was refused')
          return reply.value
        })
        // Exactly one epoch wins per starter: serialized, none lost, none doubled.
        expect(values.toSorted((x, y) => x - y)).toEqual([base + 1, base + 2])
        const epoch = JSON.parse(await readFile(path.join(runDirectory, 'lock-epoch.v1'), 'utf8'))
        expect(epoch).toEqual({ v: 1, epoch: base + 2 })
        expect(await first.exited).toEqual([0, null])
        expect(await second.exited).toEqual([0, null])
      } finally {
        for (const child of [held, first, second]) {
          if (child === undefined) continue
          child.child.kill('SIGKILL')
          await child.exited
        }
        await rm(runDirectory, { recursive: true, force: true })
      }
    },
  )
})

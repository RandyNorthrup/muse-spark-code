import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'

const messageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stage'), stage: z.string() }),
  z.strictObject({ kind: z.literal('complete') }),
  z.strictObject({ kind: z.literal('refused'), reason: z.string() }),
])
const fixture = { directory: '', file: '' }
function child(root: string, action: string, key: Buffer, stage?: string) {
  const process = spawn(
    globalThis.process.execPath,
    [fixture.file, root, action, ...(stage ? [stage] : [])],
    { env: {}, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const exited = once(process, 'exit')
  process.stderr.resume()
  process.stdin.end(key.toString('base64'))
  let pending = ''
  const message = new Promise<z.infer<typeof messageSchema>>((resolve, reject) => {
    process.once('error', reject)
    process.stdout.on('data', (bytes: Buffer) => {
      pending += bytes.toString()
      if (!pending.includes('\n')) return
      try {
        resolve(messageSchema.parse(JSON.parse(pending.trim())))
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('invalid fixture reply'))
      }
    })
  })
  return { process, exited, message }
}
async function complete(root: string, action: string, key: Buffer) {
  const run = child(root, action, key)
  try {
    expect(await run.message).toEqual({ kind: 'complete' })
    expect(await run.exited).toEqual([0, null])
  } finally {
    run.process.kill('SIGKILL')
    await run.exited
  }
}
// CM109JOINA supplies the shared cross-process writer lease; the current bare writer.lock cannot recover SIGKILL.
describe.skip('POSIX production writer crash recovery (CM109JOINA)', () => {
  beforeAll(async () => {
    fixture.directory = await mkdtemp(path.join(os.tmpdir(), 'vkill-'))
    fixture.file = path.join(fixture.directory, 'child.cjs')
    await build({
      entryPoints: ['test/unit/helpers/vault/writerCrashChild.ts'],
      outfile: fixture.file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
    })
  })
  afterAll(async () => {
    await rm(fixture.directory, { recursive: true, force: true })
  })
  const resets = [
    'writer-acquired',
    'reset.v1-written',
    'quarantine-retained',
    'vault.v1-removed',
    'slots.v1-removed',
    'pending.v1-removed',
    'anchor-retired',
  ]
  const restores = [
    'writer-acquired',
    'quarantine-retained',
    'pending.v1-written',
    'vault.v1-written',
    'slots.v1-written',
    'anchor-advanced',
    'pending.v1-removed',
  ]
  it.each([
    ...resets.map((stage) => ({ operation: 'reset', stage })),
    ...restores.map((stage) => ({ operation: 'restore', stage })),
  ])(
    'SIGKILL during $operation at $stage recovers in a new process',
    async ({ operation, stage }) => {
      const root = await mkdtemp(path.join(fixture.directory, 'case-'))
      const key = randomBytes(32)
      let held: Awaited<ReturnType<typeof child>> | undefined
      try {
        await complete(root, `prepare-${operation}`, key)
        held = child(root, operation, key, stage)
        expect(await held.message).toEqual({ kind: 'stage', stage })
        held.process.kill('SIGKILL')
        expect(await held.exited).toEqual([null, 'SIGKILL'])
        await complete(root, `recover-${operation}`, key)
        await complete(root, 'open', key)
      } finally {
        key.fill(0)
        if (held) {
          held.process.kill('SIGKILL')
          await held.exited
        }
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  it.each(['open', 'reset', 'restore'])(
    'a live writer is never taken over by %s',
    async (action) => {
      const root = await mkdtemp(path.join(fixture.directory, 'live-'))
      const key = randomBytes(32)
      let held: Awaited<ReturnType<typeof child>> | undefined
      let contender: Awaited<ReturnType<typeof child>> | undefined
      try {
        await complete(root, action === 'reset' ? 'prepare-reset' : 'prepare-restore', key)
        held = child(root, action === 'reset' ? 'reset' : 'restore', key, 'writer-acquired')
        expect(await held.message).toEqual({ kind: 'stage', stage: 'writer-acquired' })
        contender = child(root, action, key)
        expect(await contender.message).toEqual({ kind: 'refused', reason: 'busy' })
        expect(await contender.exited).toEqual([1, null])
        expect(held.process.exitCode).toBeNull()
        held.process.kill('SIGKILL')
        await held.exited
        await complete(root, action === 'reset' ? 'recover-reset' : 'recover-restore', key)
      } finally {
        key.fill(0)
        for (const run of [held, contender])
          if (run) {
            run.process.kill('SIGKILL')
            await run.exited
          }
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})

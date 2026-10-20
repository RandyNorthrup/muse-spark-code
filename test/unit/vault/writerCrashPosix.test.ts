import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import { windowsPipeExecutable } from '../../../src/host/vault/slots/windowsVaultBuild'
import { configureResources } from '../../../src/core/resources/admission'
import { runtimeResourceJobs } from '../../../src/runtime/resources/jobs'

const messageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stage'), stage: z.string() }),
  z.strictObject({ kind: z.literal('complete') }),
  z.strictObject({ kind: z.literal('refused'), reason: z.string() }),
])
const fixture = { directory: '', file: '', pipeHelper: '' }
// Windows requires the real owner-only file guard: compile the pipe helper
// once in the hook (its budget covers the build) and hand every fixture
// child the built file to serve, never a rebuild.
async function prebuildWindowsPipeHelper(): Promise<void> {
  if (process.platform !== 'win32') return
  const storageDir = path.join(fixture.directory, 'helpers')
  await mkdir(storageDir, { recursive: true })
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined || systemRoot === '') throw new Error('SystemRoot is missing')
  // The helper build is admitted by the real resource governor, configured
  // here as the standalone runtime configures it (src/runtime/resources/load.ts).
  const disposeAdmission = configureResources({ inspect: () => ({}), onError: () => undefined })
  let helper: Awaited<ReturnType<typeof windowsPipeExecutable>>
  try {
    helper = await windowsPipeExecutable({
      storageDir,
      systemRoot,
      readSlotSource: () => readFile(path.resolve('native/windows/MuseSparkVault.cs'), 'utf8'),
      readPipeSource: () => readFile(path.resolve('native/windows/MuseSparkVaultPipe.cs'), 'utf8'),
    })
    // The job helpers every child's governor records its launches through,
    // prepared once here: each child finds them present instead of compiling.
    if (
      (await runtimeResourceJobs(path.join(fixture.directory, 'jobs'), path.resolve('.'))) ===
      undefined
    )
      throw new Error('the Windows job helpers could not be prepared')
  } finally {
    disposeAdmission()
  }
  fixture.pipeHelper = path.join(fixture.directory, 'pipe-helper.json')
  await writeFile(
    fixture.pipeHelper,
    JSON.stringify({
      file: helper.file,
      sha256: helper.sha256,
      powershell: helper.powershell,
      guardSource: helper.guardSource,
    }),
  )
}
function child(root: string, action: string, key: Buffer, stage = '') {
  const process = spawn(
    globalThis.process.execPath,
    [
      fixture.file,
      root,
      action,
      // The stage slot is always filled (empty: run to completion), so the
      // Windows helper path keeps its own position (argv[5]) in every child.
      stage,
      ...(fixture.pipeHelper === '' ? [] : [fixture.pipeHelper]),
    ],
    // The writer lease identifies each process through its machine identity,
    // which lives under the data directory from the environment: a child
    // without an environment cannot name itself and is refused fail-closed.
    { env: globalThis.process.env, stdio: ['pipe', 'pipe', 'pipe'] },
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
// The shared cross-process writer lease (owner-death-only takeover) recovers
// SIGKILL at every reset/restore stage and never takes over a live writer.
describe('POSIX production writer crash recovery (CM109JOINA)', () => {
  beforeAll(async () => {
    // macOS spells its temporary root through /var (a symlink to
    // /private/var), and the vault refuses roots under a symlinked
    // ancestor: resolve to the real path first, as brokerWithoutKeyring does.
    fixture.directory = await mkdtemp(path.join(await realpath(os.tmpdir()), 'vkill-'))
    fixture.file = path.join(fixture.directory, 'child.cjs')
    await build({
      entryPoints: ['test/unit/helpers/vault/writerCrashChild.ts'],
      outfile: fixture.file,
      bundle: true,
      platform: 'node',
      format: 'cjs',
    })
    await prebuildWindowsPipeHelper()
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

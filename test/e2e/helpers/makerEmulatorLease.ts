import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { z } from 'zod'
import { claimHardwareLease, serialLeaseResource } from '../../../src/core/maker/lease'
import { makerLeaseDeps } from '../../unit/helpers/makerSerial'

export async function buildMakerLeaseWorker(file: string): Promise<void> {
  const { build } = await import('esbuild')
  const entry = path.resolve('test/e2e/helpers/makerEmulatorLease.ts')
  await build({
    stdin: {
      contents: `import { ${makerEmulatorLeaseMain.name} } from ${JSON.stringify(entry)}; ${makerEmulatorLeaseMain.name}().catch(() => { process.exitCode = 1; });`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outfile: file,
    bundle: true,
    external: ['esbuild'],
    platform: 'node',
    format: 'cjs',
  })
}

/** Compiled into an isolated Node child by the emulator e2e suite. */
export async function makerEmulatorLeaseMain(): Promise<void> {
  const [directory, port] = process.argv.slice(2)
  if (directory === undefined || port === undefined) throw new Error('lease worker arguments')
  const deps = await makerLeaseDeps(directory)
  const { promise: finished, resolve: release } = Promise.withResolvers<undefined>()
  const claimed = await claimHardwareLease(
    deps,
    await serialLeaseResource({ port }, 'linux'),
    'emulator-worker',
    () => {
      release(undefined)
      return Promise.resolve()
    },
  )
  if (claimed.status === 'busy') {
    if (claimed.holder === undefined) throw new Error('lease worker busy holder unknown')
    process.stdout.write(JSON.stringify({ status: 'busy', holderPid: claimed.holder.pid }) + '\n')
    return
  }
  if (claimed.status !== 'acquired') throw new Error('lease worker cancelled')
  process.stdin.resume()
  process.stdin.once('end', () => {
    release(undefined)
  })
  process.stdout.write(JSON.stringify({ status: 'claimed', record: claimed.record }) + '\n')
  try {
    await finished
  } finally {
    await claimed.release()
  }
  process.stdin.destroy()
}

const leaseFrame = z.discriminatedUnion('status', [
  z.object({ status: z.literal('busy'), holderPid: z.number().int().positive() }),
  z.object({
    status: z.literal('claimed'),
    record: z.object({
      version: z.literal(1),
      id: z.uuid(),
      generation: z.uuid(),
      resource: z.string(),
      holder: z.string(),
      pid: z.number().int().positive(),
      startedAt: z.string(),
      endpoint: z.string(),
    }),
  }),
])
export async function readMakerLeaseFrame(child: ChildProcessWithoutNullStreams) {
  let pending = ''
  const value = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('lease worker deadline'))
    }, 10_000)
    child.once('error', reject)
    child.stdout.on('data', (bytes: Buffer) => {
      pending += bytes.toString('utf8')
      if (Buffer.byteLength(pending) > 4096) {
        clearTimeout(timer)
        reject(new Error('lease frame oversize'))
        return
      }
      const end = pending.indexOf('\n')
      if (end === -1) {
        return
      }

      clearTimeout(timer)
      resolve(pending.slice(0, end))
    })
  })
  return leaseFrame.parse(JSON.parse(value))
}

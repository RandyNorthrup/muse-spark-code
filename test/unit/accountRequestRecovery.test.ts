import { runAccountCrashProcess } from './helpers/accountCrashProcess'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { fileAccountsMetadata } from '../../src/runtime/providers/providersFileStore'
import { withoutCredentials } from '../../src/runtime/credentialVariables'

const root = mkdtempSync(path.join(tmpdir(), 'cm1082-recovery-'))
const program = path.join(root, 'crash.cjs')
beforeAll(async () => {
  await build({
    stdin: {
      contents: `import { runAccountCrashProcess } from './test/unit/helpers/accountCrashProcess'; void ${runAccountCrashProcess.name}().catch(() => { process.exitCode = 1 })`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outfile: program,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
  })
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
const totals = z.strictObject({
  settledUsd: z.string(),
  reservedUsd: z.string(),
  uncertainUsd: z.string(),
  inputTokens: z.int(),
  outputTokens: z.int(),
  requests: z.int(),
})
const result = z.strictObject({ a: totals, b: totals })
async function accountData(name: string): Promise<string> {
  const data = path.join(root, name)
  mkdirSync(data)
  await fileAccountsMetadata(data).writeAccounts('meta', [
    { id: 'default', label: 'A', order: 0, thresholds: { requests: { day: 1 } } },
    { id: 'work', label: 'B', order: 1, thresholds: {} },
  ])
  return data
}
it('real second process recovers a lost send reservation once and sends next admitted request on B', async () => {
  const data = await accountData('accounts')
  const run = (action: string) =>
    execFileSync(process.execPath, [program, data, action], {
      env: withoutCredentials(process.env),
      encoding: 'utf8',
    })
  expect(() => run('crash')).toThrow()
  const recovered = result.parse(JSON.parse(run('recover')))
  expect(recovered.a).toMatchObject({
    reservedUsd: '0',
    uncertainUsd: '0.1',
    settledUsd: '0',
    requests: 1,
  })
  expect(recovered.b).toMatchObject({ reservedUsd: '0', settledUsd: '0.02', requests: 1 })
  expect(result.parse(JSON.parse(run('inspect')))).toEqual(recovered)
})

it('two live windows and the real CLI command share admission, metadata and one journal concurrently', async () => {
  const data = await accountData('concurrent')
  const children: ReturnType<typeof spawn>[] = []
  const finished: Promise<void>[] = []
  const start = async () => {
    const child = spawn(process.execPath, [program, data, 'hold'], {
      env: withoutCredentials(process.env),
      stdio: 'pipe',
    })
    children.push(child)
    const ready = new Promise<string>((resolve, reject) => {
      let text = ''
      child.stdout.on('data', (bytes: Buffer) => {
        text += bytes.toString()
        if (!text.includes('\n') || !text.startsWith('{"type":"ready"')) return
        const frame = z
          .strictObject({ type: z.literal('ready'), account: z.string() })
          .parse(JSON.parse(text.split('\n', 1)[0] ?? ''))
        resolve(frame.account)
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code !== null && code !== 0) reject(new Error('fixture exited before release'))
      })
    })
    const done = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('fixture failed'))
      })
    })
    finished.push(done)
    return { child, account: await ready, done }
  }
  try {
    const a = await start()
    const b = await start()
    expect([a.account, b.account]).toEqual(['default', 'work'])
    expect([a.child.exitCode, b.child.exitCode]).toEqual([null, null])
    const live = result.parse(
      JSON.parse(
        execFileSync(process.execPath, [program, data, 'cli'], {
          env: withoutCredentials(process.env),
          encoding: 'utf8',
        }),
      ),
    )
    expect(live.a).toMatchObject({ reservedUsd: '0.1', uncertainUsd: '0', requests: 1 })
    expect(live.b).toMatchObject({ reservedUsd: '0.1000125', uncertainUsd: '0', requests: 1 })
    const metadata = await fileAccountsMetadata(data).read('meta')
    expect(metadata?.accounts?.find((row) => row.id === 'work')?.thresholds).toEqual({
      requests: { day: 1 },
    })
    a.child.stdin.end('go')
    b.child.stdin.end('go')
    await Promise.all([a.done, b.done])
    const settled = result.parse(
      JSON.parse(
        execFileSync(process.execPath, [program, data, 'inspect'], {
          env: withoutCredentials(process.env),
          encoding: 'utf8',
        }),
      ),
    )
    for (const totals of [settled.a, settled.b])
      expect(totals).toMatchObject({ reservedUsd: '0', settledUsd: '0.02', requests: 1 })
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill()
    await Promise.allSettled(finished)
  }
})

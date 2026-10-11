import { execFileSync } from 'node:child_process'
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
    entryPoints: ['test/unit/helpers/accountCrashProcess.ts'],
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
it('real second process recovers a lost send reservation once and sends next admitted request on B', async () => {
  const data = path.join(root, 'accounts')
  mkdirSync(data)
  await fileAccountsMetadata(data).writeAccounts('meta', [
    { id: 'default', label: 'A', order: 0, thresholds: { requests: { day: 1 } } },
    { id: 'work', label: 'B', order: 1, thresholds: {} },
  ])
  const run = (action: string) =>
    execFileSync(process.execPath, [program, data, action], {
      env: withoutCredentials(process.env),
      encoding: 'utf8',
    })
  expect(() => run('crash')).toThrow()
  const recovered = result.parse(JSON.parse(run('recover')))
  expect(recovered.a).toMatchObject({ reservedUsd: '0.1', settledUsd: '0', requests: 1 })
  expect(recovered.b).toMatchObject({ reservedUsd: '0', settledUsd: '0.02', requests: 1 })
  expect(result.parse(JSON.parse(run('inspect')))).toEqual(recovered)
})

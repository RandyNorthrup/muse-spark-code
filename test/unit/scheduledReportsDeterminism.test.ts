import { afterAll, beforeAll, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import { deliveryPayload } from './helpers/reporting/destinations'
import { runScheduledReportFixture } from './helpers/reporting/scheduledReportProcess'

const fixture = { root: '', script: '' }
beforeAll(async () => {
  fixture.root = await mkdtemp(path.join(os.tmpdir(), 'm113-q-determinism-'))
  fixture.script = path.join(fixture.root, 'scheduled.mjs')
  await build({
    stdin: {
      contents:
        "import {runScheduledReportFixture} from './test/unit/helpers/reporting/scheduledReportProcess'; process.stdout.write(await runScheduledReportFixture());",
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    outfile: fixture.script,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  })
})
afterAll(async () => {
  await rm(fixture.root, { recursive: true, force: true })
})
function run(TZ: string, LANG: string) {
  return execFileSync(process.execPath, [fixture.script], {
    encoding: 'utf8',
    env: { SystemRoot: process.env['SystemRoot'], TZ, LANG },
  })
}
it('renders the same occurrence bytes by hand and across processes with different TZ and LANG', async () => {
  const losAngeles = run('America/Los_Angeles', 'de_DE.UTF-8')
  const tokyo = run('Asia/Tokyo', 'tr_TR.UTF-8')
  expect(losAngeles).toBe(tokyo)
  expect(losAngeles).toBe(JSON.stringify(deliveryPayload()))
  expect(await runScheduledReportFixture()).toBe(losAngeles)
})

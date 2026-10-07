import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { expect, it } from 'vitest'

const receiptSchema = z.object({
  ownedEngineFiles: z.number(),
  ownedEnginePassed: z.number(),
  testResults: z.array(
    z.object({
      files: z.array(z.string()).check(z.minLength(1)),
      passed: z.number(),
    }),
  ),
})

it('records the historical owned-engine subtotal as the sum of its persisted cohorts', async () => {
  const directory = path.resolve('docs/certification')
  const receipt = receiptSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'm104-pb-continuation-gates.json'), 'utf8')),
  )
  const cohorts = receipt.testResults.filter(({ files }) =>
    files.every((file) => file.replaceAll('\\', '/').startsWith('test/m104/engines/')),
  )
  const files = new Set(cohorts.flatMap((cohort) => cohort.files))
  const passed = cohorts.reduce((total, cohort) => total + cohort.passed, 0)
  expect(receipt.ownedEngineFiles).toBe(files.size)
  expect(receipt.ownedEnginePassed).toBe(passed)
  const record = await readFile(path.join(directory, 'm104-pb.md'), 'utf8')
  expect(record).toContain(
    `**all ${String(files.size)} owned engine files / ${String(passed)} tests**`,
  )
})

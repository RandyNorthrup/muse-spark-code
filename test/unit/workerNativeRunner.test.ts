import { expect, it } from 'vitest'
import { runTreeProgram } from '../../src/core/resources/trees/run'

it('NF the fixed native runner bounds output independently of the Node default', async () => {
  await expect(
    runTreeProgram(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(Number(process.argv[1])))', String(100 + 1)],
      { LC_ALL: 'C' },
      { maxBytes: 100 },
    ),
  ).rejects.toThrow()
})

it('NF the fixed native runner applies the caller deadline and reaps its helper', async () => {
  await expect(
    runTreeProgram(
      process.execPath,
      ['-e', 'setTimeout(() => {}, Number(process.argv[1]))', String(100 * 2)],
      { LC_ALL: 'C' },
      { timeoutMs: 100 },
    ),
  ).rejects.toThrow()
})

it('NF the fixed native runner retains bounded error details for truthful native refusals', async () => {
  await expect(
    runTreeProgram(
      process.execPath,
      ['-e', 'process.stderr.write("native-proof-refused"); process.exit(1)'],
      { LC_ALL: 'C' },
      { maxBytes: 100 },
    ),
  ).rejects.toHaveProperty('stderr', 'native-proof-refused')
})

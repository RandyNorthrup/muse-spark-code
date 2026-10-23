import path from 'node:path'
import { expect, it } from 'vitest'
import { probeChildEnvironment } from '../../src/core/executables'
import { boundedTreeProgram } from '../../src/core/resources/trees/run'

/** The probe's minimal environment: this Node's directory on PATH for its spawn. */
const probeEnv = () => probeChildEnvironment({ LC_ALL: 'C', PATH: path.dirname(process.execPath) })

it('NF the fixed native runner bounds output independently of the Node default', async () => {
  await expect(
    boundedTreeProgram(undefined, 100)(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(Number(process.argv[1])))', String(100 + 1)],
      probeEnv(),
    ),
  ).rejects.toThrow()
})

it('NF the fixed native runner applies the caller deadline and reaps its helper', async () => {
  await expect(
    boundedTreeProgram(100)(
      process.execPath,
      ['-e', 'setTimeout(() => {}, Number(process.argv[1]))', String(100 * 2)],
      probeEnv(),
    ),
  ).rejects.toThrow()
})

it('NF the fixed native runner retains bounded error details for truthful native refusals', async () => {
  await expect(
    boundedTreeProgram(undefined, 100)(
      process.execPath,
      ['-e', 'process.stderr.write("native-proof-refused"); process.exit(1)'],
      probeEnv(),
    ),
  ).rejects.toHaveProperty('stderr', 'native-proof-refused')
})

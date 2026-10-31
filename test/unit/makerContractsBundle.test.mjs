import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

const lookup = (root) => ({ root })
import { sharedMakerContracts } from '../../scripts/lib/deferredBundles.mjs'
import { hardwareGuardSplit } from '../../scripts/lib/hardwareGuardSplit.mjs'

it('PORTM103 keeps maker schemas in their shared first-use entry', async () => {
  const result = await build({
    stdin: {
      contents: "export { makerSurfaceMessageSchema } from './src/shared/makerProtocol'",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outfile: 'dist/maker-contracts-probe.js',
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'cjs',
    plugins: [sharedMakerContracts],
  })
  expect(Object.keys(result.metafile.inputs)).not.toContain('src/shared/makerProtocol.ts')
  expect(Object.values(result.metafile.outputs)[0].imports).toContainEqual({
    path: './makerContracts.js',
    kind: 'require-call',
    external: true,
  })
})

it('PORTM103 defers the context factory until its first workspace lookup', async () => {
  const result = await build({
    stdin: {
      contents: "export { createHardwareContexts } from './src/core/maker/hardwareContext'",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [hardwareGuardSplit],
  })
  let creations = 0
  const guard = {
    createHardwareContexts: () => {
      creations += 1
      return lookup
    },
    setHardwareText: () => undefined,
  }
  let loads = 0
  const load = () => {
    loads += 1
    return guard
  }
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: load })
  const contexts = module.exports.createHardwareContexts()
  expect(loads).toBe(0)
  expect(contexts('first')).toEqual({ root: 'first' })
  expect(contexts('second')).toEqual({ root: 'second' })
  expect(loads).toBe(1)
  expect(creations).toBe(1)
})

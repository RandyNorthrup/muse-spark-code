import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
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
  const lookup = vi.fn((root) => ({ root }))
  const guard = { createHardwareContexts: vi.fn(() => lookup), setHardwareText: vi.fn() }
  const load = vi.fn(() => guard)
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: load })
  const contexts = module.exports.createHardwareContexts()
  expect(load).not.toHaveBeenCalled()
  expect(contexts('first')).toEqual({ root: 'first' })
  expect(contexts('second')).toEqual({ root: 'second' })
  expect(load).toHaveBeenCalledTimes(1)
  expect(guard.createHardwareContexts).toHaveBeenCalledTimes(1)
})

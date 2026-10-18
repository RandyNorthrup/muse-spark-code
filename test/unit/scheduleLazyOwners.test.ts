import { build } from 'esbuild'
import { beforeAll, expect, it } from 'vitest'
import { createRuntimeSchedules } from '../../src/runtime/schedules/runtimeEntry'
import { HOST_PLUGINS } from '../../scripts/lib/hostPlugins.mjs'

const graphs = new Map<string, Set<string>>()
const externalEdges = new Map<string, string[]>()
beforeAll(async () => {
  const built = await build({
    entryPoints: {
      schedules: 'src/runtime/schedules/schedulesBundle.ts',
      reviewer: 'src/core/backends/modelapi/reviewerEntry.ts',
      runtimeEngine: 'src/runtime/runtimeEngineEntry.ts',
    },
    outdir: 'temp/schedule-owner-graph',
    write: false,
    metafile: true,
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode', '@napi-rs/keyring'],
    plugins: [...HOST_PLUGINS],
    logLevel: 'silent',
  })
  for (const [output, data] of Object.entries(built.metafile.outputs)) {
    const name = output.replaceAll('\\', '/').split('/').at(-1)
    if (name === undefined) continue
    graphs.set(name, new Set(Object.keys(data.inputs).map((file) => file.replaceAll('\\', '/'))))
    externalEdges.set(
      name,
      data.imports
        .filter((entry) => entry.external)
        .map((entry) => entry.path.replaceAll('\\', '/')),
    )
  }
})
it('keeps paid consent and runtime session ownership out of the first schedule surface', () => {
  expect(createRuntimeSchedules).toBeTypeOf('function')
  expect(graphs.get('schedules.js')?.has('src/host/schedules/paidBinding.ts')).toBe(false)
  expect(graphs.get('schedules.js')?.has('src/runtime/schedules/delivery.ts')).toBe(false)
  expect(graphs.get('reviewer.js')?.has('src/host/schedules/paidBinding.ts')).toBe(true)
  expect(graphs.get('runtimeEngine.js')?.has('src/runtime/schedules/delivery.ts')).toBe(true)
})

it('SCHEDULEDELIVERY: the editor delivery loads beside the first surface, never inside it', () => {
  expect(graphs.get('schedules.js')?.has('src/host/schedules/deliveryBinding.ts')).toBe(false)
  expect(graphs.get('schedules.js')?.has('src/host/schedules/backgroundTarget.ts')).toBe(false)
  expect(graphs.get('schedules.js')?.has('src/host/schedules/scheduleDeliveryEntry.ts')).toBe(false)
  expect(externalEdges.get('schedules.js')).toContain('./scheduleDelivery.js')
})

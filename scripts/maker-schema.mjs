// M103 I: deterministic JSON Schema from the production surface boundaries.
import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'

const root = path.resolve(import.meta.dirname, '..')
const { outputFiles } = await build({
  stdin: {
    contents:
      "export * as z from 'zod/mini'; export { makerHostMessageSchema, makerSurfaceMessageSchema } from './src/shared/makerProtocol'",
    resolveDir: root,
    loader: 'ts',
    sourcefile: 'maker-schema-entry.ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'silent',
})
const { z, makerHostMessageSchema, makerSurfaceMessageSchema } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
for (const [name, boundary] of [
  ['host', makerHostMessageSchema],
  ['surface', makerSurfaceMessageSchema],
]) {
  const schema = z.toJSONSchema(boundary, { unrepresentable: 'any' })
  schema['x-runtime-invariants'] = [
    'Engine approval ids and SHA-256 digests bind frozen payload and target snapshots; only the matching host-UI answer before expiry can create a binding.',
    'An answer and its binding are single-use. A forged clone is not the engine binding. Admission is checked at answer and final synchronous spawn/write.',
    'The adapter re-reads the live target immediately before the final spawn/write. Identity or registration-generation changes refuse dispatch.',
    'Travel bounds require min <= max on every axis. Preset paths are relative, contain no parent segments, option/response-file prefix or control characters.',
    'Host state, limits, keys and permission are engine/host authority. A surface message alone never enables hardware or approves a send.',
    'Enabling hardware requires a nonblank user reason. Disabling hardware needs no reason.',
    'New machine registration input cannot supply the engine-owned generation UUID. Host summaries, approval targets and stale removals retain it.',
    'Stop is dispatched independently of approval, trust, hardware enablement, active turns and ordinary queues.',
    'Device log entries are user-requested and scrubbed before crossing the surface boundary; keys never cross this protocol.',
    'Maker preview geometry is bounded by coordinate and triangle count, has complete triangles, and is rendered only by the page for its matching host-owned artifact UUID. It has no file, URL or hardware loader.',
  ]
  const file = path.join(root, `docs/schemas/maker-${name}-v1.schema.json`)
  const bytes = await format(JSON.stringify(schema), {
    ...(await resolveConfig(file)),
    filepath: file,
  })
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')) !== bytes) throw new Error(`Maker schema drift: ${name}`)
  } else await writeFile(file, bytes)
}
console.log(process.argv.includes('--check') ? 'Maker schemas match.' : 'Maker schemas written.')

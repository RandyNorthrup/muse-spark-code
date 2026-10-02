// Deterministic schemas from the production zod boundaries, not another model.
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { format, resolveConfig } from 'prettier'

const root = path.resolve(import.meta.dirname, '..')
const { outputFiles } = await esbuild.build({
  stdin: {
    contents:
      "export * as z from 'zod/mini'; export { execResultSchema, execEventSchema, exitCodeFor } from './src/runtime/exec/execProtocol'",
    resolveDir: root,
    loader: 'ts',
    sourcefile: 'exec-schema-entry.ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'silent',
})
const { z, execResultSchema, execEventSchema, exitCodeFor } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
function conditional(ifClause, thenClause) {
  return {
    if: ifClause,
    // eslint-disable-next-line unicorn/no-thenable -- JSON Schema's `then` is declarative data, never Promise behavior (PLAN §8, M80).
    then: thenClause,
  }
}
const resultJson = z.toJSONSchema(execResultSchema, { unrepresentable: 'any' })
const statuses = resultJson.properties.status.enum.filter((status) => status !== 'cancelled')
const resultConditions = statuses.map((status) =>
  conditional(
    { properties: { status: { const: status } } },
    {
      properties: {
        exitCode: { const: exitCodeFor(status, null) },
        signal: { type: 'null' },
        error: { type: status === 'completed' ? 'null' : 'object' },
        ...(status === 'completed' && {
          terminal: { const: 'completed' },
          stopReason: { const: 'end_turn' },
        }),
      },
    },
  ),
)
resultConditions.push(
  conditional(
    { properties: { status: { const: 'cancelled' } } },
    {
      properties: { error: { type: 'object' } },
      oneOf: [
        {
          properties: {
            signal: { const: 'SIGINT' },
            exitCode: { const: exitCodeFor('cancelled', 'SIGINT') },
          },
        },
        {
          properties: {
            signal: { const: 'SIGTERM' },
            exitCode: { const: exitCodeFor('cancelled', 'SIGTERM') },
          },
        },
      ],
    },
  ),
)
resultJson.allOf = resultConditions
resultJson['x-runtime-invariants'] = [
  'Muse Code has null requests/cost/ledger/budget/request limit and zero paid totals; completed Model API results have accounting. Available cap matches limits and bounds total in micro-USD.',
  'Completed Model API results require latest completed, valid, priced settlement with no transport failure.',
  'USD fields are safe integer micro-USD conversions; total = settled + uncertain + reserved in micro-USD.',
  'Cached tokens <= input tokens; reasoning tokens <= output tokens; counters are safe nonnegative integers.',
  'Paid returned + refunded + uncertain units <= admitted image attempts.',
  'Workspace-relative forward-slash paths are deduplicated; input names are basenames.',
]
const eventJson = z.toJSONSchema(execEventSchema, { unrepresentable: 'any' })
for (const variant of eventJson.anyOf) {
  if (variant.properties.type.const === 'result') variant.properties.result = resultJson
}
eventJson['x-runtime-invariants'] = [
  'Sequence starts at 1 and grows once per event; only one result is emitted per sink.',
  'ACP chunk/tool variants and nested rawInput/rawOutput/toolCallId are prohibited in update.',
  'Tool events contain name, status and durationMs only; incomplete message text is withheld whole.',
  'Ledger cap = settledUsd + uncertainUsd + reservedUsd + remainingUsd in safe integer micro-USD.',
]
await mkdir(path.join(root, 'docs/schemas'), { recursive: true })
for (const [name, schema] of [
  ['result', resultJson],
  ['event', eventJson],
]) {
  const file = path.join(root, `docs/schemas/exec-${name}-v1.schema.json`)
  const bytes = await format(JSON.stringify(schema), {
    ...(await resolveConfig(file)),
    filepath: file,
  })
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')) !== bytes) throw new Error(`Exec schema drift: ${name}`)
  } else await writeFile(file, bytes)
}
console.log(process.argv.includes('--check') ? 'Exec schemas match.' : 'Exec schemas written.')

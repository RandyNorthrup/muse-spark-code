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
      "export * as z from 'zod/mini'; export { execResultSchema, execEventSchema, exitCodeFor } from './src/runtime/exec/execProtocol'; export { EXEC_PROHIBITED_UPDATE_PATTERN, EXEC_RAW_TOOL_FIELDS } from './src/shared/constants'",
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
const {
  z,
  execResultSchema,
  execEventSchema,
  exitCodeFor,
  EXEC_PROHIBITED_UPDATE_PATTERN,
  EXEC_RAW_TOOL_FIELDS,
} = await import(
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
const resultConditions = [
  ...statuses.map((status) =>
    conditional(
      { properties: { status: { const: status } } },
      {
        properties: {
          exitCode:
            status === 'failed'
              ? {
                  enum: [
                    exitCodeFor(status, null),
                    exitCodeFor(status, null, 'output_schema_mismatch'),
                  ],
                }
              : { const: exitCodeFor(status, null) },
          signal: { type: 'null' },
          error: { type: status === 'completed' ? 'null' : 'object' },
          ...(status === 'completed' && {
            terminal: { const: 'completed' },
            stopReason: { const: 'end_turn' },
          }),
        },
      },
    ),
  ),
  conditional(
    { properties: { exitCode: { const: exitCodeFor('failed', null, 'output_schema_mismatch') } } },
    {
      properties: {
        status: { const: 'failed' },
        error: {
          properties: {
            kind: { enum: ['output_schema_mismatch', 'output_schema_validation_budget'] },
          },
          required: ['kind'],
        },
      },
    },
  ),
  conditional(
    {
      properties: {
        error: {
          type: 'object',
          properties: {
            kind: { enum: ['output_schema_mismatch', 'output_schema_validation_budget'] },
          },
          required: ['kind'],
        },
      },
      required: ['error'],
    },
    {
      properties: {
        status: { const: 'failed' },
        exitCode: { const: exitCodeFor('failed', null, 'output_schema_mismatch') },
      },
    },
  ),
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
  conditional(
    { required: ['output'] },
    {
      properties: {
        status: { const: 'completed' },
        ledger: { type: 'object', required: ['outputSchemaSha256'] },
      },
      required: ['ledger'],
    },
  ),
  conditional(
    {
      properties: {
        status: { const: 'completed' },
        ledger: { type: 'object', required: ['outputSchemaSha256'] },
      },
      required: ['ledger'],
    },
    { required: ['output'] },
  ),
]
resultJson.allOf = resultConditions
resultJson['x-runtime-invariants'] = [
  'Muse Code has null requests/cost/ledger/budget/request limit and zero paid totals; completed Model API results have accounting. Available cap matches limits and bounds total in micro-USD.',
  'Completed Model API results require latest completed, valid, priced settlement with no transport failure.',
  'USD fields are canonical decimal strings exactly representable in micro-USD; total = settled + uncertain + reserved in micro-USD.',
  'Cached tokens <= input tokens; reasoning tokens <= output tokens; counters are safe nonnegative integers.',
  'Paid returned + refunded + uncertain units <= admitted image attempts.',
  'Workspace-relative forward-slash paths are deduplicated; input names are basenames.',
]
const eventJson = z.toJSONSchema(execEventSchema, { unrepresentable: 'any' })
// The update egress rule as schema, not prose (RVM80A P2-2): no prohibited
// sessionUpdate and no raw tool field at any depth of an update.
const allowedSessionUpdate = { type: 'string', not: { pattern: EXEC_PROHIBITED_UPDATE_PATTERN } }
eventJson.$defs = {
  ...eventJson.$defs,
  execSafeUpdateValue: {
    anyOf: [
      { type: ['string', 'number', 'boolean', 'null'] },
      { type: 'array', items: { $ref: '#/$defs/execSafeUpdateValue' } },
      {
        type: 'object',
        propertyNames: { not: { enum: [...EXEC_RAW_TOOL_FIELDS] } },
        properties: { sessionUpdate: allowedSessionUpdate },
        additionalProperties: { $ref: '#/$defs/execSafeUpdateValue' },
      },
    ],
  },
}
for (const variant of eventJson.anyOf) {
  const type = variant.properties.type.const
  if (type === 'result') variant.properties.result = resultJson
  else if (type === 'update') {
    variant.properties.update.properties.sessionUpdate = allowedSessionUpdate
    variant.properties.update.$ref = '#/$defs/execSafeUpdateValue'
  }
}
eventJson['x-runtime-invariants'] = [
  'Sequence starts at 1 and grows once per event; only one result is emitted per sink.',
  'ACP chunk/tool variants and nested rawInput/rawOutput/toolCallId are prohibited in update ($defs.execSafeUpdateValue enforces it).',
  'Tool events contain name, status and durationMs only; incomplete message text is withheld whole.',
  'Ledger cap = settledUsd + uncertainUsd + reservedUsd + remainingUsd in safe integer micro-USD.',
]
await mkdir(path.join(root, 'docs/schemas'), { recursive: true })
for (const [name, schema] of [
  ['result', resultJson],
  ['event', eventJson],
]) {
  const file = path.join(root, `docs/schemas/exec-${name}-v2.schema.json`)
  const bytes = await format(JSON.stringify(schema), {
    ...(await resolveConfig(file)),
    filepath: file,
  })
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')) !== bytes) throw new Error(`Exec schema drift: ${name}`)
  } else await writeFile(file, bytes)
}
console.log(process.argv.includes('--check') ? 'Exec schemas match.' : 'Exec schemas written.')

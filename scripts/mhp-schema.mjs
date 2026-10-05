// Native plugins consume this export rather than rewriting the TypeScript
// contract. Lane I wires --check into quality:gates with the matrix gate.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { format, resolveConfig } from 'prettier'

const root = path.resolve(import.meta.dirname, '..')
const { outputFiles } = await esbuild.build({
  stdin: {
    contents:
      "export * as z from 'zod/mini'; export { MHP_METHODS } from './src/shared/hostApi/methods'; export { failureFrameSchema } from './src/shared/hostApi/protocol'; export { MHP_FEATURES, MHP_EDITORS, mhpRegistryProblems } from './src/shared/hostApi/features'; export { MHP_CAPABILITIES, MHP_FALLBACKS, offeredCapabilitiesSchema } from './src/shared/hostApi/capabilities'; export { MHP, MHP_ERROR_CODES } from './src/shared/constants'",
    resolveDir: root,
    loader: 'ts',
    sourcefile: 'mhp-schema-entry.ts',
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
  MHP_METHODS,
  failureFrameSchema,
  MHP_FEATURES,
  MHP_EDITORS,
  mhpRegistryProblems,
  MHP_CAPABILITIES,
  MHP_FALLBACKS,
  offeredCapabilitiesSchema,
  MHP,
  MHP_ERROR_CODES,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
const problems = mhpRegistryProblems(MHP_FEATURES)
if (problems.length > 0) throw new Error(problems.join('\n'))
function schema(boundary) {
  return z.toJSONSchema(boundary, {
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema !== offeredCapabilitiesSchema) return
      // zod's refinement has declarative JSON Schema equivalents. Keep
      // native-language validators as strict as the runtime boundary.
      jsonSchema.uniqueItems = true
      jsonSchema.contains = { const: 'lifecycle' }
    },
  })
}
const methods = Object.fromEntries(
  Object.entries(MHP_METHODS).map(([method, definition]) => {
    const params = definition.params
    const envelope = { jsonrpc: z.literal(MHP.jsonRpcVersion), method: z.literal(method), params }
    const call = z.strictObject(
      definition.kind === 'request'
        ? {
            ...envelope,
            id: z.union([
              z.string().check(z.minLength(1)),
              z.number().check(z.int(), z.gte(0), z.lte(MHP.maximumInteger)),
            ]),
          }
        : envelope,
    )
    return [
      method,
      {
        kind: definition.kind,
        direction: definition.direction,
        capability: definition.capability,
        fallback: definition.fallback,
        call: schema(call),
        ...(definition.kind === 'request' && {
          result: schema(
            z.strictObject({
              jsonrpc: z.literal(MHP.jsonRpcVersion),
              id: call.shape.id,
              result: definition.result,
            }),
          ),
        }),
      },
    ]
  }),
)
const contract = {
  protocol: MHP.version,
  range: { minimum: MHP.minimumVersion, maximumExclusive: MHP.maximumVersionExclusive },
  capabilities: MHP_CAPABILITIES,
  fallbacks: MHP_FALLBACKS,
  errorCodes: MHP_ERROR_CODES,
  conventions: {
    transport: 'JSON-RPC 2.0, one UTF-8 JSON object per line over stdio; no batches',
    positions: 'zero-based UTF-16 line and character',
    initialize: 'runtimeToHost; host returns the selected version and supported capabilities',
    requiredCapability: 'lifecycle',
    versioning: 'breaking schema or semantic changes require a new protocol version and snapshot',
    edits:
      'reject stale versions, dirty buffers and invalid/overlapping ranges before any side effect; apply atomically with one undo transaction',
    credentials:
      'no secrets methods, password inputs, API keys or tokens; auth/github returns authentication status only',
    settings: 'validate values against package.json contributes.configuration before persistence',
    missingStorage: 'return value:null for an absent entry',
    paidConsent:
      'runtime owns consent and ledger; UI returns opaque choice ids, never an approval grant',
  },
  failure: schema(failureFrameSchema),
  methods,
  editors: MHP_EDITORS,
  features: MHP_FEATURES,
}
const file = path.join(root, 'src/shared/hostApi/mhp-v1.schema.json')
// Feature evidence can advance without changing the wire. The remaining
// fields lock v1 independently of formatting; this generator never rewrites
// the lock. A new version gets a new snapshot and an explicitly reviewed lock.
const { editors: _editors, features: _features, ...wireContract } = contract
const digest = createHash('sha256').update(JSON.stringify(wireContract)).digest('hex')
const lock = z
  .strictObject({
    protocol: z.literal(MHP.version),
    sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  })
  .parse(JSON.parse(await readFile(path.join(root, 'src/shared/hostApi/mhp-v1.lock.json'), 'utf8')))
if (lock.sha256 !== digest)
  throw new Error(
    'MHP_VERSION_LOCK: change the protocol version before changing the frozen wire contract',
  )
const bytes = await format(JSON.stringify(contract), {
  ...(await resolveConfig(file)),
  filepath: file,
})
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8')) !== bytes) throw new Error('MHP_SCHEMA_DRIFT')
} else await writeFile(file, bytes)
console.log(process.argv.includes('--check') ? 'MHP schemas match.' : 'MHP schemas written.')

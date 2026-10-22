// Native plugins consume this export rather than rewriting the TypeScript
// contract. Lane I wires --check into quality:gates with the matrix gate.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { format, resolveConfig } from 'prettier'
import { generateMhpErrors } from './mhp-errors.mjs'

const root = path.resolve(import.meta.dirname, '..')
const { outputFiles } = await esbuild.build({
  stdin: {
    contents:
      "export * as z from 'zod/mini'; export * as panel from './src/shared/hostApi/panel'; export { MHP_METHODS } from './src/shared/hostApi/methods'; export { failureFrameSchema } from './src/shared/hostApi/protocol'; export { MHP_FEATURES, MHP_EDITORS, mhpRegistryProblems } from './src/shared/hostApi/features'; export { MHP_CAPABILITIES, MHP_FALLBACKS, offeredCapabilitiesSchema } from './src/shared/hostApi/capabilities'; export { MHP, MHP_PANEL, MHP_ERROR_CODES } from './src/shared/constants'",
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
  MHP_PANEL,
  panel,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
const problems = mhpRegistryProblems(MHP_FEATURES)
if (problems.length > 0) throw new Error(problems.join('\n'))
function schema(boundary) {
  return z.toJSONSchema(boundary, {
    // Native peers validate the accepted wire input; exact-money normalization runs in TypeScript.
    io: 'input',
    override: ({ zodSchema, jsonSchema }) => {
      // Native peers retain the closed shape instead of Zod's stripping policy.
      // Records and explicit catchalls keep their declared additionalProperties.
      if (
        jsonSchema.type === 'object' &&
        jsonSchema.properties !== undefined &&
        jsonSchema.additionalProperties === undefined
      )
        jsonSchema.additionalProperties = false
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
    initialize:
      'hostToRuntime; editor sends host metadata, locale, theme, folders, trust and capabilities; runtime returns mhp/1.5.0 and its capabilities',
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
// Feature evidence can advance without changing the wire. The remaining
// fields lock v1 independently of formatting; this generator never rewrites
// the lock. A new version gets a new snapshot and an explicitly reviewed lock.
const panelContract = {
  ...contract,
  protocol: MHP_PANEL.version,
  range: {
    minimum: MHP_PANEL.minimumVersion,
    maximumExclusive: MHP_PANEL.maximumVersionExclusive,
  },
  conventions: {
    ...contract.conventions,
    transport: 'one bounded UTF-8 NDJSON stream multiplexes JSON-RPC and MHP 1.5 envelopes',
    initialize:
      'hostToRuntime; select mhp/1.5.0 only when offered; every incompatible range receives MHP_INCOMPATIBLE_VERSION',
    panel: 'docs/ide-compatibility/host-api-panel-1.1.md',
  },
  methods: {
    ...methods,
    initialize: { ...methods.initialize, result: schema(panel.panelInitializeResultSchema) },
  },
  panel: {
    envelope: schema(panel.panelEnvelopeSchema),
    binding: schema(panel.panelBindingSchema),
    lifecycle: schema(panel.panelLifecycleSchema),
    error: schema(panel.panelErrorSchema),
    stateRequest: schema(panel.panelStateRequestSchema),
    queueBudget: schema(panel.panelQueueBudgetSchema),
    limits: {
      maximumEnvelopeBytes: MHP_PANEL.maximumEnvelopeBytes,
      maximumQueuedBytes: MHP_PANEL.maximumQueuedBytes,
      maximumQueuedMessages: MHP_PANEL.maximumQueuedMessages,
    },
    invariants: [
      'Panel frames require negotiated mhp/1.5.0. Validate shared payload and bound surface kind before delivery.',
      'One immutable session binding per surface; unknown/closed surfaces produce typed errors and no delivery.',
      'Sequence starts at 1 per surface and direction; reject duplicates and gaps without advancing.',
      'Reload retains binding and sequence, suspends delivery until ready, then replays stateRequest once.',
      'Closing drops queued messages; closed.droppedMessages counts them; warn MHP_PANEL_DROPPED when nonzero.',
      'Cap UTF-8 serialized envelope bytes before JSON parsing, including unknown fields; exclude line terminator.',
      'Bound aggregate queued bytes/messages; pause on write(false), resume on drain; overflow refuses before enqueue.',
    ],
  },
  embeddedBridge: {
    global: 'window.museHost',
    postMessage: { payload: schema(panel.panelToHostPayloadSchema), returns: 'void' },
    onMessage: { payload: schema(panel.panelToPanelPayloadSchema), returns: 'unsubscribe' },
    getState: { result: schema(panel.embeddedBridgeStateSchema), absent: 'undefined' },
    setState: { state: schema(panel.embeddedBridgeStateSchema) },
    mappings: {
      jcef: 'JBCefJSQuery; native receiver parses envelopes before dispatch',
      webView2: 'chrome.webview.postMessage; native WebMessageReceived validates before dispatch',
      swt: 'BrowserFunction; native receiver validates before dispatch',
      companion:
        'POST /panel/message; POST /panel/surface; SSE /panel/events with event:mhp and JSON frame data',
    },
  },
  framing: {
    calls: 'methods[method].call',
    results: 'methods[pendingMethod].result; correlate request id before dispatch',
    failures: 'failure',
    envelopes: ['panel.envelope', 'panel.lifecycle', 'panel.error'],
    batches: false,
    logging: 'stdout is protocol only; stderr carries redacted technical diagnostics',
  },
}
// Legacy snapshot filenames remain native build inputs. Both advertise the one
// current version; neither retains a validator or negotiation route for older ones.
const adoption = process.argv.find((arg) => arg.startsWith('--adopt-version='))
if (
  adoption !== undefined &&
  (adoption !== `--adopt-version=${MHP.version}` || process.argv.includes('--check'))
)
  throw new Error('MHP_INVALID_VERSION_ADOPTION')
const exports = []
for (const [name, snapshot] of [
  ['v1', contract],
  ['v1.1', panelContract],
]) {
  const file = path.join(root, `src/shared/hostApi/mhp-${name}.schema.json`)
  const lockFile = path.join(root, `src/shared/hostApi/mhp-${name}.lock.json`)
  const { editors: _editors, features: _features, ...wireContract } = snapshot
  const digest = createHash('sha256').update(JSON.stringify(wireContract)).digest('hex')
  const lock = z
    .strictObject({ protocol: z.string(), sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/u)) })
    .parse(JSON.parse(await readFile(lockFile, 'utf8')))
  if (adoption !== undefined) {
    if (lock.protocol === snapshot.protocol) throw new Error('MHP_VERSION_ALREADY_ADOPTED')
  } else if (lock.protocol !== snapshot.protocol || lock.sha256 !== digest)
    throw new Error(`MHP_VERSION_LOCK: ${name} frozen wire contract changed (expected ${digest})`)
  const options = { ...(await resolveConfig(file)), filepath: file }
  const bytes = await format(JSON.stringify(snapshot), options)
  const locked = await format(
    JSON.stringify({ protocol: snapshot.protocol, sha256: digest }),
    options,
  )
  exports.push({ file, lockFile, bytes, locked })
}
for (const { file, lockFile, bytes, locked } of exports) {
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')) !== bytes) throw new Error(`MHP_SCHEMA_DRIFT: ${file}`)
  } else {
    if (adoption !== undefined) await writeFile(lockFile, locked)
    await writeFile(file, bytes)
  }
}
await generateMhpErrors(process.argv.includes('--check'))
console.log(process.argv.includes('--check') ? 'MHP schemas match.' : 'MHP schemas written.')

// C-M106-1: opt-in evidence collection, never imported by a product bundle.
// The lead supplies the key on stdin. No key file, environment or child process.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { isEntryPoint } from './lib/entryPoint.mjs'

const ORIGIN = 'https://api.meta.ai/v1'
const MODEL = 'muse-spark-1.3-contributor'
const BODY_MAX_BYTES = 2 * 1024 * 1024
const KEY_MAX_BYTES = 8192
const REQUEST_TIMEOUT_MS = 60_000
const HEADERS = new Set([
  'content-type',
  'retry-after',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
])
const OMIT = new Set(['encrypted_content', 'encryptedContent'])
const object = z.record(z.string(), z.json())
const digest = (text) => createHash('sha256').update(text).digest('hex')
const tool = {
  type: 'function',
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius'] } },
    required: ['city', 'unit'],
    additionalProperties: false,
  },
}
const answer = {
  type: 'json_schema',
  name: 'capital_answer',
  strict: true,
  schema: {
    type: 'object',
    properties: { country: { type: 'string' }, capital: { type: 'string' } },
    required: ['country', 'capital'],
    additionalProperties: false,
  },
}
const base = { model: MODEL, store: false, reasoning: { effort: 'minimal' } }
export const CAPTURE_PLAN = [
  { name: 'status-public', method: 'GET', route: '/status', authenticated: false },
  { name: 'status-key', method: 'GET', route: '/status', authenticated: true },
  {
    name: 'u9-raw-strict-stream',
    method: 'POST',
    route: '/responses',
    authenticated: true,
    body: {
      ...base,
      input: 'Use get_weather for Oslo in celsius. Call the tool; do not answer in prose.',
      tools: [tool],
      stream: true,
      max_output_tokens: 2000,
    },
  },
  {
    name: 'u9-strict-refusal',
    method: 'POST',
    route: '/responses',
    authenticated: true,
    body: {
      ...base,
      input: 'Use get_weather for Oslo in celsius.',
      tools: [{ ...tool, parameters: { ...tool.parameters, additionalProperties: true } }],
      max_output_tokens: 100,
    },
  },
  {
    name: 'u10-structured-cap',
    method: 'POST',
    route: '/responses',
    authenticated: true,
    body: {
      ...base,
      input: 'Return only the country France and its capital Paris.',
      tools: [tool],
      text: { format: answer },
      max_output_tokens: 131_072,
    },
  },
  {
    name: 'output-incomplete',
    method: 'POST',
    route: '/responses',
    authenticated: true,
    body: {
      ...base,
      // Meta refuses max_output_tokens below 16 (HTTP 400, 2026-10-10
      // output-incomplete.json receipt): probe at the documented minimum
      // with a prompt that needs far more, so the run observes a genuine
      // incomplete stop instead of a refusal.
      input: 'Write the integers from 1 through 100, one per line, without skipping any.',
      max_output_tokens: 16,
    },
  },
]

/** Keep unknown wire fields, removing opaque reasoning and literal credential echoes. */
export function scrubCapture(value, key) {
  if (typeof value === 'string' || Array.isArray(value))
    return typeof value === 'string'
      ? value.replaceAll(key, '<redacted-key>')
      : value.map((entry) => scrubCapture(entry, key))
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([name]) => !OMIT.has(name))
          .map(([name, entry]) => [
            name.replaceAll(key, '<redacted-key>'),
            scrubCapture(entry, key),
          ]),
      )
    : value
}

/** Parse complete raw SSE data, without synthesising delta split points or IDs. */
export function parseCaptureSse(text) {
  const normalized = text.replaceAll(/\r\n?/g, '\n')
  if (!normalized.endsWith('\n\n'))
    throw new Error('SSE capture ended without a complete final block')
  return normalized.split('\n\n').flatMap((block) => {
    const lines = block.split('\n')
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).replace(/^ /, ''))
      .join('\n')
    if (data === '' || data === '[DONE]') return []
    return {
      event:
        lines
          .find((line) => line.startsWith('event:'))
          ?.slice('event:'.length)
          .trim() ?? null,
      data: object.parse(JSON.parse(data)),
    }
  })
}

/** These checks use earlier captured fields; a refusal never becomes capability evidence. */
export function checkCapture(name, status, body) {
  if (name === 'u9-strict-refusal') {
    if (status !== 400) throw new Error('Strict-schema refusal was not observed')
    z.object({
      error: z.object({
        type: z.literal('invalid_request_error'),
        param: z.literal('parameters'),
        message: z.literal("'additionalProperties' is required to be supplied and to be false."),
      }),
    }).parse(body)
    return
  }
  if (status !== 200) throw new Error('Capture request was refused')
  switch (name) {
    case 'status-public':
    case 'status-key': {
      z.object({
        is_alive: z.boolean(),
        service_status: z.string(),
        service_message: z.string(),
        updated_at: z.string(),
        model_statuses: z.array(z.json()),
      }).parse(body)
      return
    }
    case 'u9-raw-strict-stream': {
      const frames = z
        .array(z.object({ data: object }))
        .parse(body)
        .map((frame) => frame.data)
      const done = frames.find((frame) => frame.type === 'response.function_call_arguments.done')
      const deltas = frames.filter(
        (frame) => frame.type === 'response.function_call_arguments.delta',
      )
      if (
        !done ||
        deltas.length === 0 ||
        frames.every((frame) => frame.type !== 'response.completed')
      )
        throw new Error('Raw argument deltas, done and completion were not all captured')
      z.string().min(1).parse(done.item_id)
      const argumentsText = z.string().parse(done.arguments)
      if (
        deltas.some(
          (frame) => frame.item_id !== done.item_id || frame.output_index !== done.output_index,
        ) ||
        deltas.map((frame) => z.string().parse(frame.delta)).join('') !== argumentsText
      )
        throw new Error('Argument deltas do not match their done frame')
      z.strictObject({ city: z.literal('Oslo'), unit: z.literal('celsius') }).parse(
        JSON.parse(argumentsText),
      )
      return
    }
    case 'u10-structured-cap': {
      const response = object.parse(body)
      if (response.status !== 'completed' || response.max_output_tokens !== 131_072)
        throw new Error('Recommended output cap was not accepted')
      const output = z.array(object).parse(response.output)
      const text = output
        .filter((item) => item.type === 'message')
        .flatMap((item) => z.array(object).parse(item.content))
        .filter((part) => part.type === 'output_text')
        .map((part) => z.string().parse(part.text))
        .join('')
      z.strictObject({ country: z.literal('France'), capital: z.literal('Paris') }).parse(
        JSON.parse(text),
      )
      return
    }
    case 'output-incomplete': {
      const response = object.parse(body)
      if (
        response.status !== 'incomplete' ||
        response.incomplete_details?.reason !== 'max_output_tokens'
      )
        throw new Error('Output-limit incomplete response was not observed')
      return
    }
    default: {
      throw new Error('Unknown capture check')
    }
  }
}

async function boundedBody(response) {
  if (!response.body) throw new Error('Capture response has no body')
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > BODY_MAX_BYTES) throw new Error('Capture response exceeds byte limit')
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
    }
  }
}

/** Six sequential requests, no retries; persist evidence before checking it. */
export async function runMetaCapture(options) {
  const { outputDir, fetchImpl = fetch } = options
  const manifest = {
    startedAt: new Date().toISOString(),
    provider: 'meta',
    model: MODEL,
    workspace: 'standalone HTTPS capture; no repository content',
    state: 'running',
    postResponseAttempts: 0,
    nonInferenceAttempts: 0,
    refusedPostAttempts: 0,
    captures: [],
  }
  const saveManifest = () =>
    writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      mode: 0o600,
    })
  let didCreateDirectory = false
  try {
    z.string().min(1).max(KEY_MAX_BYTES).regex(/^\S+$/).parse(options.key)
    await mkdir(outputDir, { mode: 0o700 })
    didCreateDirectory = true
    for (const step of CAPTURE_PLAN) {
      if (step.method === 'POST') manifest.postResponseAttempts++
      else manifest.nonInferenceAttempts++
      await saveManifest()
      const response = await fetchImpl(`${ORIGIN}${step.route}`, {
        method: step.method,
        headers: {
          ...(step.authenticated && { Authorization: `Bearer ${options.key}` }),
          ...(step.body && { 'Content-Type': 'application/json' }),
        },
        ...(step.body && { body: JSON.stringify(step.body) }),
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (step.method === 'POST' && !response.ok) manifest.refusedPostAttempts++
      const raw = await boundedBody(response)
      const isStreamed =
        response.headers.get('content-type')?.includes('text/event-stream') === true
      const body = isStreamed ? parseCaptureSse(raw) : object.parse(JSON.parse(raw))
      const filename = `${step.name}.json`
      const capture = scrubCapture(
        {
          provenance: {
            timestamp: new Date().toISOString(),
            sourceSha256: digest(raw),
            projection: true,
            omitted: [...OMIT],
          },
          request: {
            method: step.method,
            route: step.route,
            authenticated: step.authenticated,
            ...(step.body && { body: step.body }),
          },
          status: response.status,
          headers: Object.fromEntries([...response.headers].filter(([name]) => HEADERS.has(name))),
          ...(isStreamed ? { frames: body } : { response: body }),
        },
        options.key,
      )
      const bytes = JSON.stringify(capture, null, 2) + '\n'
      await writeFile(path.join(outputDir, filename), bytes, { mode: 0o600, flag: 'wx' })
      const row = { file: filename, sha256: digest(bytes), status: response.status, checked: false }
      manifest.captures.push(row)
      await saveManifest()
      checkCapture(step.name, response.status, body)
      row.checked = true
      await saveManifest()
    }
    manifest.state = 'complete'
  } catch {
    manifest.state = 'failed'
    throw new Error('M106 capture failed; inspect the scrubbed receipt, do not enable capabilities')
  } finally {
    options.key = ''
    manifest.finishedAt = new Date().toISOString()
    if (didCreateDirectory) await saveManifest()
  }
  return manifest
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'M106 Meta evidence capture (developer tool). --plan prints six requests without network access.\nLive: --allow-paid-captures <NEW_OUTPUT_DIRECTORY>, key on stdin only.\nTwo status GETs and four contributor-model POST attempts, no retries.\nOne request advertises a 131,072-token cap; Model API billing applies.\nRaw responses stay in memory; scrubbed receipts and hashes are written.\nThe lead reviews receipts before installing fixtures or enabling capabilities.\n',
    )
  } else if (args.length === 1 && args[0] === '--plan') {
    process.stdout.write(JSON.stringify(CAPTURE_PLAN, null, 2) + '\n')
  } else {
    if (args.length !== 2 || args[0] !== '--allow-paid-captures')
      throw new Error(
        'Use --help; live captures need an explicit opt-in and a new output directory',
      )
    const options = { key: '', outputDir: path.resolve(args[1]) }
    try {
      for await (const chunk of process.stdin) {
        if (Buffer.byteLength(options.key) + chunk.length > KEY_MAX_BYTES)
          throw new Error('Stdin key exceeds byte limit')
        options.key += chunk.toString('utf8')
      }
      options.key = options.key.trim()
      await runMetaCapture(options)
    } finally {
      options.key = ''
    }
  }
}
if (isEntryPoint(import.meta.url)) {
  try {
    await main()
  } catch {
    process.stderr.write('M106 capture failed. Use --help or inspect the scrubbed manifest.\n')
    process.exitCode = 1
  }
}

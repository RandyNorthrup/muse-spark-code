// The real configured-provider request builder, all the way out of our
// code (M95c): a real providers file, the vendored models.dev snapshot as
// the catalogue, the real record resolution, codec, credential and header
// reads, the real pinned transport and Node's own HTTP client. The far end
// is a real local socket (Node's HTTP server, not our code) that records
// the request as it arrived and closes the connection without answering:
// no answer is ever invented, and nothing leaves the machine. Secrets are
// held in the product's own memory store, the one headless runs use.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'
import type * as z from 'zod/mini'
import {
  createConfiguredProviderServices,
  type ConfiguredProviderOptions,
} from '../../../src/core/providers/configured'
import { noRetryBudget } from '../../../src/core/backends/modelapi/transport'
import type { CreateResponseBody } from '../../../src/core/backends/modelapi/schemas'
import type { providerEntrySchema } from '../../../src/core/providers/providersFile'
import { memorySecretStoreFor } from '../../../src/runtime/exec/keyInput'
import { PROVIDERS_FILE_VERSION } from '../../../src/shared/constants'

/** One request as it reached the socket (Node lowercases header names). */
export interface WireRequest {
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
}

/** A listening socket that records every request and answers none of them. */
export interface RecordingSocket {
  /** `http://127.0.0.1:<port>`: a loopback address the endpoint policy accepts as local. */
  readonly origin: string
  readonly requests: readonly WireRequest[]
  close(): Promise<void>
}

export async function recordingSocket(): Promise<RecordingSocket> {
  const requests: WireRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      const headers = Object.fromEntries(
        Object.entries(request.headers).flatMap(([name, value]) =>
          typeof value === 'string' ? [[name, value]] : [],
        ),
      )
      requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers,
        body: text === '' ? undefined : JSON.parse(text),
      })
      // Recorded; the connection closes without a status line or a byte back.
      response.socket?.destroy()
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('No TCP address to record on')
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      }),
  }
}

/** One suite's recording socket: opened at load, closed after the suite. */
export function suiteSocket(): Promise<RecordingSocket> {
  const opened = recordingSocket()
  afterAll(async () => {
    const socket = await opened
    await socket.close()
  })
  return opened
}

/** A providers-file entry as the file holds it (the schema's input). */
export type ProviderEntryInput = z.input<typeof providerEntrySchema>

/**
A keyed Responses-API server entry `openai` at `origin`, offering `models`
with tool calling confirmed and a window and output cap of their own (a
custom server's limits are the person's): OpenAI's own preset is pinned to
its public origin, and this one speaks the same Responses codec.
*/
export function responsesEntryAt(origin: string, models: readonly string[]): ProviderEntryInput {
  const limits = { contextTokens: 1_050_000, outputTokens: 128_000 }
  const tools = { tools: { calling: { state: 'yes' as const, value: true as const } } }
  return {
    id: 'openai',
    preset: 'custom',
    format: 'responses',
    address: origin,
    auth: 'apiKey',
    models: [...models],
    modelLimits: Object.fromEntries(models.map((model) => [model, limits])),
    modelCapabilities: Object.fromEntries(models.map((model) => [model, tools])),
  }
}

/** The vendored catalogue snapshot the build ships (real data, never invented). */
export const VENDORED_CATALOGUE = path.resolve('vendor/models-dev/snapshot.json')

/** A stored key record, bound to `origin`, as the panel and `providers add` write it. */
export function storedKey(origin: string, secret: string): string {
  return JSON.stringify({ v: 1, auth: 'apiKey', origin, secret })
}

/**
Configured services over one providers file holding `entries`, with
`secrets` held in the product's memory store. Extra options (a setting
reader) ride as given.
*/
export function wireServices(
  entries: readonly ProviderEntryInput[],
  secrets: Readonly<Record<string, string>>,
  extra: Partial<ConfiguredProviderOptions> = {},
): ReturnType<typeof createConfiguredProviderServices> {
  const directory = mkdtempSync(path.join(tmpdir(), 'provider-wire-'))
  const configFile = path.join(directory, 'providers.json')
  writeFileSync(configFile, JSON.stringify({ v: PROVIDERS_FILE_VERSION, providers: entries }))
  return createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile: VENDORED_CATALOGUE,
    secrets: memorySecretStoreFor(secrets),
    ...extra,
  })
}

/**
The one turn request `body` makes for `ref`, as it reached the socket.
The socket closes unanswered, so the turn ends in a send failure; a
failure before any request reached the socket is rethrown.
*/
export async function turnRequest(
  services: ReturnType<typeof createConfiguredProviderServices>,
  socket: RecordingSocket,
  ref: string,
  body: CreateResponseBody,
): Promise<WireRequest> {
  const registry = services.registry
  if (registry.list === undefined) throw new TypeError('Expected a listing registry')
  await registry.list()
  const resolved = await registry.resolve(ref)
  const before = socket.requests.length
  const stream = resolved.client.streamResponse(
    body,
    new AbortController().signal,
    undefined,
    noRetryBudget(),
  )
  try {
    await stream.next()
  } catch (error: unknown) {
    // The unanswered close is the expected end; anything earlier is the test's own.
    if (socket.requests.length === before) throw error
  }
  const request = socket.requests.at(-1)
  if (request === undefined || socket.requests.length !== before + 1)
    throw new Error(`Expected exactly one request, saw ${String(socket.requests.length - before)}`)
  return request
}

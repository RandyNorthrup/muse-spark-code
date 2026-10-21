// A DIAGNOSTIC, not part of the real-life run: no scenario loads it.
//
// A tap on a process's own `fetch`, loaded before the product starts
// (`NODE_OPTIONS=--import <this file>`). It records what the product itself
// sends to one host and what that host answers, and changes neither. It is
// how the provider's own answer was read on 0.18.2, which shows a person
// "the response did not complete" whatever the provider said
// (read-provider-answer.mjs starts the product with it).
//
// No credential is written: the value of every credential header is
// replaced. No retry reaches the provider: once RL_TAP_POSTS requests have
// left for the tapped host, the next one fails here.
//
//   RL_TAP_OUT    the file the records are appended to (JSON lines)
//   RL_TAP_HOST   the host to record (api.x.ai, api.mistral.ai, ...)
//   RL_TAP_POSTS  how many POSTs may leave (1; 2 reads a tool turn's second request)
import { Buffer } from 'node:buffer'
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { TextDecoder } from 'node:util'

const out = process.env.RL_TAP_OUT
const host = process.env.RL_TAP_HOST
const allowed = Number(process.env.RL_TAP_POSTS ?? '1')
const original = fetch
const CREDENTIAL = /authorization|api-key|x-goog-api-key|cookie|token/iu
const BODY_LIMIT = 300_000
const sent = { posts: 0 }

/** The pairs of some headers, however the caller wrote them (a Headers object, a list, a plain object). */
function pairsOf(headers) {
  if (headers === undefined || headers === null) return []
  if (typeof headers.entries === 'function') return headers.entries().toArray()
  return Array.isArray(headers) ? headers : Object.entries(headers)
}

function headersOf(headers) {
  const seen = {}
  const pairs = pairsOf(headers)
  for (const [name, value] of pairs) {
    seen[name.toLowerCase()] = CREDENTIAL.test(name) ? '<credential>' : value
  }
  return seen
}

function bodyOf(body) {
  if (body === undefined || body === null) return null
  if (typeof body === 'string') return body
  return body instanceof Uint8Array
    ? Buffer.from(body).toString('utf8')
    : `[a body of type ${Object.prototype.toString.call(body)}]`
}

const note = (entry) => {
  appendFileSync(out, `${JSON.stringify(entry)}\n`)
}

/** Reads the answer as it arrives: when the product ends the stream itself, what had arrived is kept. */
async function keep(copy, base) {
  const decoder = new TextDecoder()
  let text = ''
  let end = 'the stream ended'
  try {
    if (copy.body !== null) {
      for await (const chunk of copy.body) text += decoder.decode(chunk, { stream: true })
    }
  } catch (error) {
    end = `cut: ${error instanceof Error ? error.message : String(error)}`
  }
  note({
    ...base,
    responseBody: text.slice(0, BODY_LIMIT),
    responseBytes: text.length,
    responseEnd: end,
  })
}

async function tapped(input, init) {
  const url = new URL(typeof input === 'string' ? input : (input?.url ?? String(input)))
  if (url.host !== host) return await original.call(globalThis, input, init)
  const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase()
  const entry = {
    url: `${url.origin}${url.pathname}`,
    query: url.searchParams.keys().toArray(),
    method,
    requestHeaders: headersOf(init?.headers ?? input?.headers),
    requestBody: bodyOf(init?.body),
  }
  if (method === 'POST') {
    sent.posts += 1
    if (sent.posts > allowed) {
      note({ ...entry, notSent: 'one POST more than the tap lets through: no retry is sent' })
      throw new TypeError('fetch-tap: no further request')
    }
  }
  let response
  try {
    response = await original.call(globalThis, input, init)
  } catch (error) {
    note({ ...entry, failed: error instanceof Error ? error.message : String(error) })
    throw error
  }
  // Not awaited: the product reads its own copy of the answer at its own pace.
  void keep(response.clone(), {
    ...entry,
    status: response.status,
    statusText: response.statusText,
    responseHeaders: headersOf(response.headers),
  })
  return response
}

if (out !== undefined && host !== undefined && typeof original === 'function') {
  // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the tap is this replacement: the process's own fetch, recorded and passed on unchanged (PLAN §8)
  globalThis.fetch = tapped
}

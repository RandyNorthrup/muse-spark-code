// M115w WQ: the served-GitHub rig. The injected fetch serves recorded
// bodies (the 2026-10-22 captures unless a test says otherwise) as real
// Responses and records every request's method, URL, authorization
// presence and parsed body. Nothing here touches the network.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { CoreLogger } from '../../../../src/core/logging'

const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures', 'm115w', 'github-issues')

export function watchdogCaptured(caseId: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, caseId, 'response.body.json'), 'utf8'))
}

export interface CapturedObject {
  readonly number?: unknown
  readonly [key: string]: unknown
}

function objectsOfList(value: unknown): CapturedObject[] {
  if (!Array.isArray(value)) throw new TypeError('the capture holds a list')
  const list: unknown[] = value
  return list.map((item) => {
    if (typeof item !== 'object' || item === null) throw new TypeError('the capture holds objects')
    return Object.fromEntries(
      Object.entries(item).map(([key, entry]): [string, unknown] => [key, entry]),
    )
  })
}

/** A captured list as plain objects, for the tests that re-serve it. */
export function capturedObjects(caseId: string): CapturedObject[] {
  return objectsOfList(watchdogCaptured(caseId))
}

/** The search capture's real issues, served as an issue list. */
export function capturedSearchIssues(): CapturedObject[] {
  const search = watchdogCaptured('github-search-issues')
  if (typeof search !== 'object' || search === null || !('items' in search))
    throw new TypeError('the capture holds a search')
  return objectsOfList(search.items)
}

export interface ServedGithubCall {
  readonly method: string
  readonly url: string
  readonly authorized: boolean
  readonly body: unknown
}

export function serveGithub(routes: Readonly<Record<string, { status: number; body: unknown }>>) {
  const calls: ServedGithubCall[] = []
  const fetcher: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let href: string
    if (typeof input === 'string') href = input
    else if (input instanceof URL) href = input.href
    else href = input.url
    const authorization = new Headers(init?.headers).get('Authorization') ?? ''
    calls.push({
      method: init?.method ?? 'GET',
      url: href,
      authorized: authorization.startsWith('Bearer ') && authorization.length > 7,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const route = routes[`${init?.method ?? 'GET'} ${href.split('?', 2)[0] ?? ''}`]
    const status = route?.status ?? 404
    return Promise.resolve(Response.json(route?.body ?? { message: 'Not Found' }, { status }))
  }
  return { fetch: fetcher, calls }
}

export function watchdogLogger(logged: string[]): CoreLogger {
  return {
    trace: (message) => {
      logged.push(message)
    },
    info: (message) => {
      logged.push(message)
    },
    warn: (message) => {
      logged.push(message)
    },
    error: (message) => {
      logged.push(message)
    },
  }
}

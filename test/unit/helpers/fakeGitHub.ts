// An in-process GitHub REST API for the M71 tests: a `fetch` that answers
// the calls GitHubClient makes from the captured responses
// (githubCapture.ts), recording each request. A test replaces a route's
// answer to play GitHub refusing it.

import {
  CAPTURED_CHECKS_RUNNING,
  CAPTURED_FORK_REPOSITORY,
  CAPTURED_NOT_FOUND,
  CAPTURED_PULL_FORK,
  CAPTURED_PULL_LIST,
  CAPTURED_PULL_OWN,
  CAPTURED_REPOSITORY,
  CAPTURED_STATUS_NONE,
  CAPTURED_USER,
} from './githubCapture'

export interface RecordedRequest {
  readonly method: string
  /** Path and query, without the base URL. */
  readonly path: string
  readonly authorization: string | null
  readonly apiVersion: string | null
  readonly userAgent: string | null
  readonly body: unknown
}

export interface FakeAnswer {
  readonly status: number
  readonly body: unknown
  readonly headers?: Readonly<Record<string, string>>
}

export const FAKE_GITHUB_BASE = 'https://api.github.test'
export const FAKE_GITHUB_TOKEN = 'fake-github-token'

type Route = (request: RecordedRequest) => FakeAnswer | undefined

export interface FakeGitHub {
  readonly fetch: typeof fetch
  readonly requests: RecordedRequest[]
  /** Answer `method path` (the path without its query) with `answer` from now on. */
  answer(
    method: string,
    path: string,
    answer: FakeAnswer | ((request: RecordedRequest) => FakeAnswer),
  ): void
  /** Make the next calls throw as a request that never reached GitHub does. */
  failNetwork(error: Error): void
}

const REPO_PATH = '/repos/RandyNorthrup/muse-spark-code'

function ok(body: unknown): FakeAnswer {
  return { status: 200, body }
}

function withoutQuery(path: string): string {
  const index = path.indexOf('?')
  return index === -1 ? path : path.slice(0, index)
}

/** What the captured GitHub answered for each route. */
const defaults: Route = (request) => {
  const path = withoutQuery(request.path)
  const key = `${request.method} ${path}`
  const table: Readonly<Record<string, FakeAnswer>> = {
    'GET /user': ok(CAPTURED_USER),
    [`GET ${REPO_PATH}`]: ok(CAPTURED_REPOSITORY),
    ['GET /repos/Piangpi1997/muse-spark-code']: ok(CAPTURED_FORK_REPOSITORY),
    [`GET ${REPO_PATH}/pulls/51`]: ok(CAPTURED_PULL_FORK),
    [`GET ${REPO_PATH}/pulls/56`]: ok(CAPTURED_PULL_OWN),
    [`GET ${REPO_PATH}/pulls`]: ok(CAPTURED_PULL_LIST),
    [`POST ${REPO_PATH}/pulls`]: { status: 201, body: CAPTURED_PULL_OWN },
    [`GET ${REPO_PATH}/commits/${CAPTURED_PULL_OWN.head.sha}/check-runs`]:
      ok(CAPTURED_CHECKS_RUNNING),
    [`GET ${REPO_PATH}/commits/${CAPTURED_PULL_OWN.head.sha}/status`]: ok(CAPTURED_STATUS_NONE),
  }
  return table[key]
}

/** The captured repository's routes: its pulls #51 and #56, their checks, the account. */
export function fakeGitHub(): FakeGitHub {
  const requests: RecordedRequest[] = []
  const overrides = new Map<string, (request: RecordedRequest) => FakeAnswer>()
  let networkError: Error | undefined
  const fakeFetch: typeof fetch = (input, init) => {
    if (networkError !== undefined) {
      return Promise.reject(networkError)
    }
    let href: string
    if (typeof input === 'string') {
      href = input
    } else {
      href = input instanceof URL ? input.href : input.url
    }
    const url = new URL(href)
    const headers = new Headers(init?.headers)
    const bodyText = typeof init?.body === 'string' ? init.body : undefined
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      authorization: headers.get('authorization'),
      apiVersion: headers.get('x-github-api-version'),
      userAgent: headers.get('user-agent'),
      body: bodyText === undefined ? undefined : JSON.parse(bodyText),
    }
    requests.push(request)
    const override = overrides.get(`${request.method} ${withoutQuery(request.path)}`)
    const answer = override?.(request) ??
      defaults(request) ?? { status: 404, body: CAPTURED_NOT_FOUND }
    return Promise.resolve(
      Response.json(answer.body, {
        status: answer.status,
        headers: { 'content-type': 'application/json; charset=utf-8', ...answer.headers },
      }),
    )
  }
  return {
    fetch: fakeFetch,
    requests,
    answer: (method, path, answer) => {
      overrides.set(`${method} ${path}`, typeof answer === 'function' ? answer : () => answer)
    },
    failNetwork: (error) => {
      networkError = error
    },
  }
}

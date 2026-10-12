// A fake github.com on loopback for M123 (PLAN.md D104): one HTTP server
// that answers both GitHub's REST API, replaying M71's captures through the
// unit tests' route table (test/unit/helpers/fakeGitHub.ts), and GitHub's
// OAuth device flow, from the documented shapes
// (test/unit/helpers/github/deviceFlow.ts). A runtime started by a test is
// pointed at its addresses; nothing reaches GitHub.
//
// - REST: each token has the scopes the test gave it, sent back in
//   `X-OAuth-Scopes`; an unknown token gets 401.
// - Device flow: codes last `expiresInS` (900 s), polls closer together than
//   the interval get `slow_down` and five more seconds, the user approves or
//   denies with `approve`/`deny`, and every documented error can be played.
// - `failNetwork` drops each connection, as a lost network does.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import * as z from 'zod/mini'
import {
  GITHUB_DEVICE_CODE_EXPIRES_S,
  GITHUB_DEVICE_GRANT_TYPE,
  GITHUB_DEVICE_POLL_INTERVAL_S,
  GITHUB_DEVICE_SLOW_DOWN_STEP_S,
  GITHUB_DEVICE_VERIFICATION_URL,
  GITHUB_SCOPES_HEADER,
} from '../../src/shared/constants'
import {
  DOCUMENTED_ACCESS_TOKEN,
  DOCUMENTED_DEVICE_CODE,
  DOCUMENTED_EXPIRING_ACCESS_TOKEN,
  documentedDeviceFlowError,
  type DeviceFlowError,
} from '../unit/helpers/github/deviceFlow'
import { FAKE_GITHUB_TOKEN, fakeGitHub, type FakeGitHub } from '../unit/helpers/fakeGitHub'

const HTTP_OK = 200
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404
const MS_PER_S = 1000
const REFRESH_GRANT_TYPE = 'refresh_token'
const jsonParams = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
// The OAuth parameters the fake reads; any other is kept in the record.
const oauthParams = z.looseObject({
  client_id: z.optional(z.string()),
  device_code: z.optional(z.string()),
  grant_type: z.optional(z.string()),
  refresh_token: z.optional(z.string()),
})
type OAuthParams = z.infer<typeof oauthParams>
export const FAKE_OAUTH_CLIENT_ID = 'Iv1.fakeclientid0000'

export interface FakeGitHubServerOptions {
  /** The device flow's clock; real time unless a test drives it. */
  readonly now?: () => number
  readonly expiresInS?: number
  readonly intervalS?: number
  /** Answer the token endpoint as an app with expiring user tokens does. */
  readonly expiringTokens?: boolean
  /** The address the device-code reply names; GitHub's unless a test plays a phishing reply. */
  readonly verificationUri?: string
}

interface DeviceCode {
  readonly userCode: string
  readonly issuedAt: number
  intervalS: number
  lastPollAt: number | undefined
  state: 'pending' | 'approved' | 'denied' | 'used'
}

export interface DeviceFlowRequest {
  readonly path: string
  readonly at: number
  readonly params: Readonly<Record<string, string>>
}

export interface FakeGitHubServer {
  /** Point the REST client here (its `baseUrl`). */
  readonly apiBaseUrl: string
  readonly deviceCodeUrl: string
  readonly tokenUrl: string
  /** The REST requests, as the unit fake records them. */
  readonly rest: FakeGitHub
  /** Every device-flow request, with the fake clock's time. */
  readonly deviceRequests: DeviceFlowRequest[]
  /** Tokens the device flow issued, so a test can grep for them. */
  readonly issuedTokens: string[]
  /** Let `token` (a canary of the test's) call the REST API with `scopes` (`''` for none). */
  grantToken(token: string, scopes: string): void
  approve(userCode?: string): void
  deny(userCode?: string): void
  /** Answer every token request with `error` from now on (`undefined` to stop). */
  playError(error: DeviceFlowError | undefined): void
  /** Refuse to issue device codes, as an app without the device flow does. */
  disableDeviceFlow(): void
  failNetwork(isFailing: boolean): void
  close(): Promise<void>
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The OAuth endpoints take a form or JSON body; both are read. */
function formOf(request: IncomingMessage, body: string): Record<string, string> {
  if ((request.headers['content-type'] ?? '').includes('application/json')) {
    const parsed = jsonParams.parse(body === '' ? {} : JSON.parse(body))
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
  }
  return Object.fromEntries(new URLSearchParams(body))
}

/** JSON when asked for (`Accept: application/json`), GitHub's form encoding otherwise. */
function sendOAuth(request: IncomingMessage, response: ServerResponse, body: object): void {
  if ((request.headers.accept ?? '').includes('application/json')) {
    response.writeHead(HTTP_OK, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
    return
  }
  response.writeHead(HTTP_OK, { 'content-type': 'application/x-www-form-urlencoded' })
  response.end(
    new URLSearchParams(
      Object.entries(body).map(([key, value]) => [key, String(value)]),
    ).toString(),
  )
}

export async function startFakeGitHub(
  options: FakeGitHubServerOptions = {},
): Promise<FakeGitHubServer> {
  const now = options.now ?? Date.now
  const rest = fakeGitHub()
  const scopesByToken = new Map<string, string>([[FAKE_GITHUB_TOKEN, 'repo']])
  const codes = new Map<string, DeviceCode>()
  const deviceRequests: DeviceFlowRequest[] = []
  const issuedTokens: string[] = []
  const refreshTokens = new Set<string>()
  let playedError: DeviceFlowError | undefined
  let isDeviceFlowDisabled = false
  let isNetworkFailing = false
  let issued = 0

  const issueTokens = (): object => {
    issued += 1
    const accessToken = `${DOCUMENTED_ACCESS_TOKEN.access_token}-${String(issued)}`
    issuedTokens.push(accessToken)
    scopesByToken.set(accessToken, DOCUMENTED_ACCESS_TOKEN.scope)
    if (options.expiringTokens !== true) {
      return { ...DOCUMENTED_ACCESS_TOKEN, access_token: accessToken }
    }
    const refreshToken = `${DOCUMENTED_EXPIRING_ACCESS_TOKEN.refresh_token}-${String(issued)}`
    issuedTokens.push(refreshToken)
    refreshTokens.add(refreshToken)
    return {
      ...DOCUMENTED_EXPIRING_ACCESS_TOKEN,
      access_token: accessToken,
      refresh_token: refreshToken,
    }
  }

  const deviceCode = (params: OAuthParams): object => {
    if (params.client_id !== FAKE_OAUTH_CLIENT_ID) {
      return documentedDeviceFlowError('incorrect_client_credentials')
    }
    if (isDeviceFlowDisabled) {
      return documentedDeviceFlowError('device_flow_disabled')
    }
    const serial = String(codes.size + 1)
    const code = `${DOCUMENTED_DEVICE_CODE.device_code}-${serial}`
    const userCode = `${DOCUMENTED_DEVICE_CODE.user_code.slice(0, -serial.length)}${serial}`
    const intervalS = options.intervalS ?? GITHUB_DEVICE_POLL_INTERVAL_S
    codes.set(code, {
      userCode,
      issuedAt: now(),
      intervalS,
      lastPollAt: undefined,
      state: 'pending',
    })
    return {
      ...DOCUMENTED_DEVICE_CODE,
      device_code: code,
      user_code: userCode,
      verification_uri: options.verificationUri ?? GITHUB_DEVICE_VERIFICATION_URL,
      expires_in: options.expiresInS ?? GITHUB_DEVICE_CODE_EXPIRES_S,
      interval: intervalS,
    }
  }

  const refresh = (params: OAuthParams): object => {
    const token = params.refresh_token ?? ''
    if (!refreshTokens.delete(token)) {
      // GitHub's documented word for an unknown refresh token ("Refreshing
      // user access tokens"); neither re-read in lane 0 nor captured.
      return { error: 'bad_refresh_token' }
    }
    return issueTokens()
  }

  const accessToken = (params: OAuthParams): object => {
    if (params.grant_type === REFRESH_GRANT_TYPE && options.expiringTokens === true) {
      return refresh(params)
    }
    if (params.grant_type !== GITHUB_DEVICE_GRANT_TYPE) {
      return documentedDeviceFlowError('unsupported_grant_type')
    }
    if (params.client_id !== FAKE_OAUTH_CLIENT_ID) {
      return documentedDeviceFlowError('incorrect_client_credentials')
    }
    if (playedError !== undefined) {
      return documentedDeviceFlowError(playedError)
    }
    const code = codes.get(params.device_code ?? '')
    if (code === undefined || code.state === 'used') {
      return documentedDeviceFlowError('incorrect_device_code')
    }
    const at = now()
    const expiresInS = options.expiresInS ?? GITHUB_DEVICE_CODE_EXPIRES_S
    if (at >= code.issuedAt + expiresInS * MS_PER_S) {
      return documentedDeviceFlowError('expired_token')
    }
    const previous = code.lastPollAt
    code.lastPollAt = at
    if (previous !== undefined && at - previous < code.intervalS * MS_PER_S) {
      code.intervalS += GITHUB_DEVICE_SLOW_DOWN_STEP_S
      return documentedDeviceFlowError('slow_down', code.intervalS)
    }
    if (code.state === 'denied') {
      return documentedDeviceFlowError('access_denied')
    }
    if (code.state === 'pending') {
      return documentedDeviceFlowError('authorization_pending')
    }
    code.state = 'used'
    return issueTokens()
  }

  const answerRest = async (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    body: string,
  ): Promise<void> => {
    const token = (request.headers.authorization ?? '').replace(/^Bearer /u, '')
    const scopes = scopesByToken.get(token)
    if (scopes === undefined) {
      // No 401 body was captured (M71); the client reads only the status.
      response.writeHead(HTTP_UNAUTHORIZED, { 'content-type': 'application/json; charset=utf-8' })
      response.end('{}')
      return
    }
    const answer = await rest.fetch(url.href, {
      method: request.method ?? 'GET',
      headers: Object.entries(request.headers).flatMap(([key, value]): [string, string][] =>
        typeof value === 'string' ? [[key, value]] : [],
      ),
      ...(body !== '' && { body }),
    })
    const headers = Object.fromEntries(answer.headers.entries())
    response.writeHead(answer.status, { ...headers, [GITHUB_SCOPES_HEADER]: scopes })
    response.end(await answer.text())
  }

  const server = createServer((request, response) => {
    if (isNetworkFailing) {
      request.socket.destroy()
      return
    }
    void (async () => {
      const body = await readBody(request)
      const url = new URL(request.url ?? '/', 'https://fake.github.invalid')
      if (url.pathname === '/login/device/code' || url.pathname === '/login/oauth/access_token') {
        const form = formOf(request, body)
        deviceRequests.push({ path: url.pathname, at: now(), params: form })
        const params = oauthParams.parse(form)
        sendOAuth(
          request,
          response,
          url.pathname === '/login/device/code' ? deviceCode(params) : accessToken(params),
        )
        return
      }
      if (url.pathname === '/user' || url.pathname.startsWith('/repos/')) {
        await answerRest(request, response, url, body)
        return
      }
      response.writeHead(HTTP_NOT_FOUND)
      response.end()
    })()
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the fake GitHub has no port')
  }
  const origin = `http://127.0.0.1:${String(address.port)}`

  const setState = (state: DeviceCode['state'], userCode: string | undefined) => {
    for (const code of codes.values()) {
      if (code.state === 'pending' && (userCode === undefined || userCode === code.userCode)) {
        code.state = state
      }
    }
  }

  return {
    apiBaseUrl: origin,
    deviceCodeUrl: `${origin}/login/device/code`,
    tokenUrl: `${origin}/login/oauth/access_token`,
    rest,
    deviceRequests,
    issuedTokens,
    grantToken: (token, scopes) => {
      scopesByToken.set(token, scopes)
    },
    approve: (userCode) => {
      setState('approved', userCode)
    },
    deny: (userCode) => {
      setState('denied', userCode)
    },
    playError: (error) => {
      playedError = error
    },
    disableDeviceFlow: () => {
      isDeviceFlowDisabled = true
    },
    failNetwork: (isFailing) => {
      isNetworkFailing = isFailing
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => {
          if (error === undefined) {
            resolve()
          } else {
            reject(error)
          }
        })
      }),
  }
}

// The HTTPS connector for real, for the remote suites: the owner's own grant
// command, the runtime's `serve-http` command on a real data folder, and the
// person at the PC and in the browser played by the helpers below, reading
// the owner code from the same terminal output a person reads.
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import tls from 'node:tls'
import { expect } from 'vitest'
import { CONNECTOR_FOLDER } from '../../../src/shared/constants'
import { EN } from '../../../src/shared/l10n/en'
import {
  parseConnectorCommand,
  runConnectorCommand,
  type CommandIo,
} from '../../../src/runtime/connector/command'
import type { ConnectorRuntimeDeps } from '../../../src/runtime/connector/entry'
import { runConnectorRemote } from '../../../src/runtime/connector/remoteEntry'
import { connectorStorageGuard } from '../../../src/runtime/connector/storageGuard'
import { ConnectorStore } from '../../../src/runtime/connector/store'

const FIXTURES = path.join(process.cwd(), 'test/fixtures/connector-remote')
export const FIXTURE_CERT = path.join(FIXTURES, 'localhost.cert.pem')
export const FIXTURE_KEY = path.join(FIXTURES, 'localhost.key.pem')
/** The serving arguments of a person who has a certificate for localhost. */
export const TLS_ARGUMENTS = ['--tls-cert', FIXTURE_CERT, '--tls-key', FIXTURE_KEY]

/** This process trusts the fixture certificate, as a client with the person's own CA would. */
export function trustFixtureCertificate(): void {
  tls.setDefaultCACertificates([
    ...tls.getCACertificates('default'),
    readFileSync(FIXTURE_CERT, 'utf8'),
  ])
}

export async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => {
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve()
    })
  })
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

/** An address of this machine that is not loopback, if it has one (a LAN client would use it). */
export function lanAddress(): string | undefined {
  const interfaces = Object.values(os.networkInterfaces())
  for (const addresses of interfaces) {
    const list = addresses ?? []
    for (const address of list) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return undefined
}

export async function dataFolder(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'm124-remote-'))
}

export function storeFor(data: string): ConnectorStore {
  return new ConnectorStore(data, connectorStorageGuard(path.join(data, CONNECTOR_FOLDER)))
}

const unbound = () => Promise.reject(new Error('not bound in this suite'))

/** The person in their own terminal, confirming: the command IO every owner-command suite shares. */
export const OWNER_COMMAND_IO: CommandIo = {
  isInteractive: true,
  now: Date.now,
  print: () => undefined,
  printError: (line) => {
    throw new Error(line)
  },
  confirm: () => Promise.resolve(true),
}

/** The owner's own grant or revoke command, confirmed as the person in their terminal. */
export async function ownerCommand(data: string, argv: readonly string[]): Promise<number> {
  const command = parseConnectorCommand(argv)
  if (command?.kind !== 'grant' && command?.kind !== 'revoke') {
    throw new Error('not an owner grant or revoke command')
  }
  return await runConnectorCommand(storeFor(data), command, OWNER_COMMAND_IO)
}

export async function grantUserLibrary(data: string, scopes: readonly string[]): Promise<void> {
  const code = await ownerCommand(data, [
    'grant',
    '--user-library',
    ...scopes.flatMap((scope) => ['--scope', scope]),
  ])
  expect(code).toBe(0)
}

function runtimeDeps(
  data: string,
  argv: readonly string[],
  stderr: PassThrough,
  stdin: PassThrough,
): ConnectorRuntimeDeps {
  return {
    argv,
    table: EN,
    locale: 'en',
    dataFolder: data,
    homeDir: data,
    version: '0.0.0-test',
    stdin,
    stdout: new PassThrough(),
    stderr,
    isInteractive: true,
    registered: () => [],
    openBrowser: unbound,
    schedules: { list: unbound, pause: unbound },
    reports: { generate: unbound },
    storageGuard: connectorStorageGuard(path.join(data, CONNECTOR_FOLDER)),
  }
}

function collect(stream: PassThrough): () => string {
  let output = ''
  stream.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  return () => output
}

/** Runs one remote command to its end: the exit code and what it printed. */
export async function remoteCommand(
  data: string,
  argv: readonly string[],
  typed = '',
): Promise<{ readonly code: number; readonly output: string }> {
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const output = collect(stderr)
  stdin.end(typed)
  const code = await runConnectorRemote(runtimeDeps(data, argv, stderr, stdin), Promise.resolve())
  return { code, output: output() }
}

/** The owner registers a client for the SDK suite's callback; its client id. */
export async function registerClient(data: string, name = 'SDK suite'): Promise<string> {
  const added = await remoteCommand(
    data,
    ['client', 'add', '--name', name, '--redirect-uri', 'http://127.0.0.1:8765/callback'],
    'y\n',
  )
  expect(added.code).toBe(0)
  const clientId = /client_id is (\S+)/u.exec(added.output)?.[1]
  if (clientId === undefined) throw new Error(`no client id in: ${added.output}`)
  return clientId
}

export interface RunningRemote {
  readonly origin: string
  readonly mcpUrl: string
  readonly port: number
  /** Everything the connector printed in its terminal so far. */
  readonly output: () => string
  /** The owner code as the terminal shows it now. */
  readonly ownerCode: () => string
  readonly stop: () => Promise<number>
}

/** `serve-http` as a person starts it; resolves once it says where it listens. */
export async function startRemote(
  data: string,
  extra: readonly string[],
  chosenPort?: number,
): Promise<RunningRemote> {
  const port = chosenPort ?? (await freePort())
  const stderr = new PassThrough()
  const output = collect(stderr)
  const stopped = Promise.withResolvers<undefined>()
  const argv = ['serve-http', '--port', String(port), ...extra]
  const running = runConnectorRemote(
    runtimeDeps(data, argv, stderr, new PassThrough()),
    stopped.promise,
  )
  const deadline = Date.now() + 4000
  for (;;) {
    const origin = /listening at (\S+)\/mcp /u.exec(output())?.[1]
    if (origin !== undefined) {
      return {
        origin,
        mcpUrl: `${origin}/mcp`,
        port,
        output,
        ownerCode: () => {
          let last: string | undefined
          for (const match of output().matchAll(/allowing a new connection: ([A-Z2-9]{12})/gu)) {
            last = match[1]
          }
          if (last === undefined) throw new Error(`no owner code in: ${output()}`)
          return last
        },
        stop: async () => {
          stopped.resolve(undefined)
          return await running
        },
      }
    }
    if (Date.now() > deadline) {
      stopped.resolve(undefined)
      throw new Error(`the connector did not start: ${output()} (exit ${String(await running)})`)
    }
    await sleep(20)
  }
}

export interface Answer {
  readonly decision: 'allow' | 'deny'
  readonly code?: string
}

export interface BrowserResult {
  /** The address the browser ended at: the client's callback, or the page it was left on. */
  readonly landed: URL
  /** The consent page the person saw (empty when the request never reached one). */
  readonly page: string
  /** What the browser was left looking at, when it was not sent back to the client. */
  readonly rest: string
}

/**
The person's browser: opens the authorization address, reads the consent
page, and answers it. A browser keeps cookies; this one does too. It stops
at the first address `isDone` accepts (the client's callback).
*/
export async function browse(
  authorizationUrl: URL,
  answer: Answer,
  isDone: (url: URL) => boolean,
): Promise<BrowserResult> {
  const jar = new Map<string, string>()
  const cookies = (): string => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  const remember = (response: Response): void => {
    for (const set of response.headers.getSetCookie()) {
      const pair = set.split(';', 1)[0] ?? ''
      const at = pair.indexOf('=')
      jar.set(pair.slice(0, at), pair.slice(at + 1))
    }
  }
  let url = authorizationUrl
  let page = ''
  for (let hop = 0; hop < 12; hop += 1) {
    let response = await fetch(url, { redirect: 'manual', headers: { cookie: cookies() } })
    remember(response)
    if (response.status === 200 && url.pathname.startsWith('/interaction/')) {
      // The consent page: the person reads it and answers.
      page = await response.text()
      const form = new URLSearchParams({ decision: answer.decision })
      if (answer.code !== undefined) form.set('code', answer.code)
      response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: cookies(),
          origin: authorizationUrl.origin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
      })
      remember(response)
    }
    const location = response.headers.get('location')
    if (location !== null && response.status >= 300 && response.status < 400) {
      url = new URL(location, url)
      if (isDone(url)) return { landed: url, page, rest: '' }
      continue
    }
    // Not a redirect: the person is still at a page (a wrong code, an expired request).
    return { landed: url, page, rest: await response.text() }
  }
  throw new Error('the browser was redirected too many times')
}

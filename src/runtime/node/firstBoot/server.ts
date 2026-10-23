// M110os OS3: the setup server. Serves only the setup pages until the
// one-time code opens them; the code stays the bearer credential for every
// later POST, so there are no cookies, no sessions and no clock. Completed
// setups answer everything with the done page. The server never logs
// request content: codes, keys and passwords stay out of every log.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { HTTP_STATUS } from '../../../shared/constants'
import { listDisks } from './disks'
import {
  codePage,
  donePage,
  failedPage,
  reviewPage,
  seedPrefill,
  wizardPage,
  type WizardPrefill,
} from './pages'
import { parseSshPublicKey, setupChoicesSchema, type SetupChoices } from './schemas'
import { readAndConsumeSeed } from './seed'
import { listenHttpServer } from '../../httpServer'
import { issueSetupCode } from './setupCode'
import {
  acceptSetupCode,
  applySeed,
  completeSetup,
  createSetupState,
  isCodeHolder,
  loadSetupState,
  recordChoices,
  saveSetupState,
  type SetupState,
} from './setupStore'

const TCP_MAX_PORT = 65_535

export interface SetupServerOptions {
  readonly stateDir: string
  readonly bootDir: string
  readonly host: string
  readonly port: number
  /** Deployment-set bound on POST bodies (companionUpload's maxBytes precedent). */
  readonly maxBodyBytes: number
  readonly sysfsRoot: string
}

export interface SetupServer {
  readonly server: Server
  readonly url: string
  close(): Promise<void>
}

export interface PreparedSetup {
  readonly state: SetupState
  /** The fresh code, or null when the setup already started. */
  readonly code: string | null
}

/** Load the setup, or start it fresh: a code plus the consumed seed. */
export function prepareSetupState(stateDir: string, bootDir: string): PreparedSetup {
  const existing = loadSetupState(stateDir)
  if (existing !== null) return { state: existing, code: null }
  const code = issueSetupCode()
  const state = applySeed(createSetupState(code), readAndConsumeSeed(bootDir))
  saveSetupState(stateDir, state)
  return { state, code }
}

/** Start the setup server. The console takes the fresh code from the prepared setup. */
export async function createSetupServer(options: SetupServerOptions): Promise<SetupServer> {
  if (
    options.host.length === 0 ||
    !Number.isSafeInteger(options.port) ||
    options.port < 0 ||
    options.port > TCP_MAX_PORT ||
    !Number.isSafeInteger(options.maxBodyBytes) ||
    options.maxBodyBytes <= 0 ||
    !path.isAbsolute(options.stateDir) ||
    !path.isAbsolute(options.bootDir) ||
    !path.isAbsolute(options.sysfsRoot)
  ) {
    throw new Error('Invalid setup server configuration')
  }
  prepareSetupState(options.stateDir, options.bootDir)
  const server = createServer((request, response) => {
    // Expected setup failures (state, disk, sysfs, request IO) answer 500;
    // anything else is a bug and fails closed.
    void handleRequest(request, response, options).catch((error: unknown) => {
      if (isSetupFailure(error)) {
        if (response.headersSent) response.destroy()
        else send(response, HTTP_STATUS.internalServerError, failedPage('setup-failed'))
        return
      }
      throw error
    })
  })
  const address = await listenHttpServer(server, options.host, options.port, 'setup listen failed')
  return {
    server,
    url: `http://${options.host}:${String(address.port)}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      }),
  }
}

function send(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(html)
}

type BodyRead =
  { readonly status: 'read'; readonly text: string } | { readonly status: 'too-large' }

function readBody(request: IncomingMessage, maxBytes: number): Promise<BodyRead> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let isTooLarge = false
    // Past the bound the body is drained and dropped, so the 413 still
    // goes out over the same socket. Node's own request timeout bounds a
    // slow drip; the byte bound is the deployment's.
    request.on('data', (chunk: Buffer) => {
      if (isTooLarge) return
      size += chunk.length
      if (size > maxBytes) {
        isTooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.once('end', () => {
      resolve(
        isTooLarge
          ? { status: 'too-large' }
          : { status: 'read', text: Buffer.concat(chunks).toString('utf8') },
      )
    })
    request.once('error', (cause: Error) => {
      reject(new Error('setup request is not readable', { cause }))
    })
  })
}

/** Our own typed setup failures (fixed `setup …` messages), distinct from bugs. */
function isSetupFailure(cause: unknown): boolean {
  return cause instanceof Error && cause.message.startsWith('setup ')
}

interface ChoiceFields extends WizardPrefill {
  readonly code: string
  readonly psk: string
  readonly tpmPin: string
}

function fieldsOf(body: URLSearchParams): ChoiceFields {
  return {
    code: body.get('code') ?? '',
    networkKind: body.get('networkKind') ?? 'dhcp',
    ssid: body.get('ssid') ?? '',
    psk: body.get('psk') ?? '',
    diskTarget: body.get('diskTarget') ?? '',
    encryption: body.get('encryption') ?? 'tpm',
    tpmPin: body.get('tpmPin') ?? '',
    sshKey: body.get('sshKey') ?? '',
    chrome: body.get('chrome') ?? 'skip',
    nvidia: body.get('nvidia') ?? 'skip',
  }
}

type ChoicesResult =
  | { readonly ok: true; readonly choices: SetupChoices }
  | { readonly ok: false; readonly reason: string }

function choicesOf(fields: ChoiceFields): ChoicesResult {
  const sshLines = fields.sshKey
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  for (const line of sshLines) {
    if (parseSshPublicKey(line) === undefined) return { ok: false, reason: 'ssh-key' }
  }
  const checked = setupChoicesSchema.safeParse({
    network:
      fields.networkKind === 'wifi'
        ? { kind: 'wifi', ssid: fields.ssid, ...(fields.psk !== '' && { psk: fields.psk }) }
        : { kind: 'dhcp' },
    disk: {
      target: fields.diskTarget,
      encryption: fields.encryption,
      ...(fields.tpmPin !== '' && { tpmPin: fields.tpmPin }),
    },
    sshKey: sshLines.join('\n'),
    chrome: fields.chrome,
    nvidia: fields.nvidia,
  })
  if (!checked.success) {
    const path = checked.error.issues[0]?.path.join('-') ?? 'choices'
    return { ok: false, reason: `choices-${path}` }
  }
  return { ok: true, choices: checked.data }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: SetupServerOptions,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    send(response, HTTP_STATUS.methodNotAllowed, failedPage('method-not-allowed'))
    return
  }
  const pathname = (request.url ?? '/').split('?', 1)[0] ?? '/'
  if (request.method === 'GET') {
    if (pathname !== '/') {
      send(response, HTTP_STATUS.notFound, failedPage('not-found'))
      return
    }
    const state = loadSetupState(options.stateDir)
    if (state === null) {
      send(response, HTTP_STATUS.internalServerError, failedPage('setup-state'))
      return
    }
    send(response, HTTP_STATUS.ok, state.completed ? donePage() : codePage(null))
    return
  }
  if (pathname !== '/code' && pathname !== '/choices' && pathname !== '/complete') {
    send(response, HTTP_STATUS.notFound, failedPage('not-found'))
    return
  }
  const contentType = request.headers['content-type'] ?? ''
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    send(response, HTTP_STATUS.badRequest, failedPage('content-type'))
    return
  }
  const body = await readBody(request, options.maxBodyBytes)
  if (body.status === 'too-large') {
    send(response, HTTP_STATUS.requestTooLarge, failedPage('body-too-large'))
    return
  }
  const fields = fieldsOf(new URLSearchParams(body.text))
  const state = loadSetupState(options.stateDir)
  if (state === null) {
    send(response, HTTP_STATUS.internalServerError, failedPage('setup-state'))
    return
  }
  if (state.completed) {
    send(response, HTTP_STATUS.ok, donePage())
    return
  }
  if (pathname === '/code') {
    const accepted = acceptSetupCode(state, fields.code)
    if (!accepted.ok) {
      if (accepted.reason === 'completed') {
        send(response, HTTP_STATUS.ok, donePage())
        return
      }
      send(response, HTTP_STATUS.ok, codePage(accepted.reason))
      return
    }
    saveSetupState(options.stateDir, accepted.state)
    send(
      response,
      HTTP_STATUS.ok,
      wizardPage({
        state: accepted.state,
        code: fields.code,
        disks: listDisks(options.sysfsRoot),
        prefill: seedPrefill(accepted.state),
        sshError: false,
        formError: null,
      }),
    )
    return
  }
  if (!isCodeHolder(state, fields.code)) {
    send(response, HTTP_STATUS.ok, codePage(state.codeConsumed ? 'used' : null))
    return
  }
  if (pathname === '/complete') {
    if (state.choices === null) {
      send(
        response,
        HTTP_STATUS.ok,
        wizardPage({
          state,
          code: fields.code,
          disks: listDisks(options.sysfsRoot),
          prefill: seedPrefill(state),
          sshError: false,
          formError: null,
        }),
      )
      return
    }
    saveSetupState(options.stateDir, completeSetup(state))
    send(response, HTTP_STATUS.ok, donePage())
    return
  }
  const result = choicesOf(fields)
  if (!result.ok) {
    send(
      response,
      HTTP_STATUS.ok,
      wizardPage({
        state,
        code: fields.code,
        disks: listDisks(options.sysfsRoot),
        prefill: {
          networkKind: fields.networkKind,
          ssid: fields.ssid,
          diskTarget: fields.diskTarget,
          encryption: fields.encryption,
          sshKey: fields.sshKey,
          chrome: fields.chrome,
          nvidia: fields.nvidia,
        },
        sshError: result.reason === 'ssh-key',
        formError: result.reason === 'ssh-key' ? null : result.reason,
      }),
    )
    return
  }
  const recorded = recordChoices(state, result.choices)
  saveSetupState(options.stateDir, recorded)
  const recoveryKey = recorded.recoveryKey
  if (recoveryKey === null) {
    send(response, HTTP_STATUS.internalServerError, failedPage('setup-state'))
    return
  }
  send(
    response,
    HTTP_STATUS.ok,
    reviewPage({
      code: fields.code,
      choices: result.choices,
      tpmPinSet: fields.tpmPin !== '',
      pskSet: fields.psk !== '',
      recoveryKey,
    }),
  )
}

// M124 (D106): `muse-spark-code-acp mcp …`. Serving is the default; the
// owner's commands make, revoke and inspect local connection grants and work
// the kill switch. Widening authority (grant, resume) needs the owner to type
// a confirmation in an interactive terminal; narrowing it (revoke, kill)
// never asks. Grants live outside every repository; launching the server or
// trusting a repository grants nothing.
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  CONNECTOR_DEFAULT_CONNECTION,
  CONNECTOR_REMOTE_DEFAULT_PORT,
  CONNECTOR_SCHEMA_VERSION,
  UI_TEXT,
} from '../../shared/constants'
import {
  CONNECTOR_SCOPES,
  connectorConnectionIdSchema,
  connectorGrantSchema,
  type ConnectorGrant,
  type ConnectorScope,
} from '../../shared/connector'
import { fill } from '../../shared/l10n/text'
import { ConnectorAudit } from '../../core/connector/audit'
import { grantScopes } from '../../core/connector/policy'
import type { ConnectorStore } from './store'

const WORKSPACE_ID_HEX = 8
const EXIT_USAGE = 2
const EXIT_FAILED = 1
/** The kill switch belongs to no connection: its receipts have their own journal. */
const OWNER_JOURNAL = '_owner'

/**
The owner's command leaves its control receipt (design §6): grant and
revoke in that connection's journal, the kill switch in the owner's. Best
effort: the owner's own command is never held back by the journal.
*/
async function controlReceipt(
  store: ConnectorStore,
  io: CommandIo,
  journal: string,
  control: 'grant' | 'revoke' | 'kill' | 'resume',
  grantGeneration?: number,
): Promise<void> {
  const audit = new ConnectorAudit(store.audit(journal, io.now), journal, io.now, (text) => text)
  await audit.record({
    event: 'control',
    control,
    ...(grantGeneration !== undefined && { grantGeneration }),
  })
}

/** The HTTPS serving command (D217); run by the remote bundle alone. */
export interface ServeHttpCommand {
  readonly kind: 'serveHttp'
  readonly connectionId: string
  readonly port: number
  /** `loopback` (default), `lan` (every interface), or one IP address of this PC. */
  readonly bind: string
  readonly tlsCert: string | undefined
  readonly tlsKey: string | undefined
  /** The person's own tunnel or proxy ends TLS in front: plain HTTP on loopback behind it. */
  readonly isTunnel: boolean
  /** How clients name this PC (a tunnel or proxy in front); the issuer. */
  readonly publicUrl: string | undefined
  /** Clients may register themselves (RFC 7591); off unless the person asks. */
  readonly allowOpenRegistration: boolean
  readonly accessTokenMinutes: number | undefined
  readonly signInDays: number | undefined
}

export type ConnectorCommand =
  | ServeHttpCommand
  | { readonly kind: 'serve'; readonly connectionId: string }
  | {
      readonly kind: 'clientAdd'
      readonly connectionId: string
      readonly name: string
      readonly redirectUris: readonly string[]
      readonly scopes: readonly string[]
    }
  | { readonly kind: 'clientList'; readonly connectionId: string }
  | { readonly kind: 'clientRemove'; readonly connectionId: string; readonly clientId: string }
  | {
      readonly kind: 'grant'
      readonly connectionId: string
      readonly workspaces: readonly string[]
      readonly scopes: readonly string[]
      readonly content: boolean
      readonly userLibrary: boolean
    }
  | { readonly kind: 'revoke'; readonly connectionId: string }
  | { readonly kind: 'kill' | 'resume' | 'status' | 'usage' }

const DEFAULT_SCOPES: readonly ConnectorScope[] = [
  'operations:read',
  'prompts:read',
  'sharing:read',
  'schedules:read',
  'reports:read',
  'control:stop',
]

const PORT_MAX = 65_535

function portOf(text: string | undefined): number | undefined {
  if (text === undefined) return CONNECTOR_REMOTE_DEFAULT_PORT
  const port = Number(text)
  return Number.isSafeInteger(port) && port >= 1 && port <= PORT_MAX ? port : undefined
}

/** A whole number of at least one, or undefined for absent or malformed. */
function wholeOf(text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  const value = Number(text)
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

/** The word that names the command, and the arguments after it. */
function actionOf(argv: readonly string[]): { action: string; args: readonly string[] } {
  const [first, second = '', ...tail] = argv
  if (first === 'client') return { action: `client-${second}`, args: tail }
  return first === undefined || first.startsWith('--')
    ? { action: 'serve', args: argv }
    : { action: first, args: argv.slice(1) }
}

/** Which commands read each option: an option on any other command is a usage error. */
const OPTION_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  workspace: ['grant'],
  content: ['grant'],
  'user-library': ['grant'],
  scope: ['grant', 'client-add'],
  port: ['serve-http'],
  bind: ['serve-http'],
  'tls-cert': ['serve-http'],
  'tls-key': ['serve-http'],
  'public-url': ['serve-http'],
  tunnel: ['serve-http'],
  'open-registration': ['serve-http'],
  'token-minutes': ['serve-http'],
  'sign-in-days': ['serve-http'],
  name: ['client-add'],
  'redirect-uri': ['client-add'],
  'client-id': ['client-remove'],
}

const REMOTE_KINDS: ReadonlySet<string> = new Set([
  'serveHttp',
  'clientAdd',
  'clientList',
  'clientRemove',
])

/** The commands the remote bundle runs; the stdio bundle refuses them with usage. */
export function isRemoteCommand(
  command: ConnectorCommand,
): command is Extract<
  ConnectorCommand,
  { kind: 'serveHttp' | 'clientAdd' | 'clientList' | 'clientRemove' }
> {
  return REMOTE_KINDS.has(command.kind)
}

export function parseConnectorCommand(argv: readonly string[]): ConnectorCommand | undefined {
  // Asking for help is never a usage error, wherever the word sits.
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'usage' }
  const { action, args } = actionOf(argv)
  try {
    const { values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: {
        connection: { type: 'string' },
        workspace: { type: 'string', multiple: true },
        scope: { type: 'string', multiple: true },
        content: { type: 'boolean' },
        'user-library': { type: 'boolean' },
        port: { type: 'string' },
        bind: { type: 'string' },
        'tls-cert': { type: 'string' },
        'tls-key': { type: 'string' },
        'public-url': { type: 'string' },
        tunnel: { type: 'boolean' },
        'open-registration': { type: 'boolean' },
        'token-minutes': { type: 'string' },
        'sign-in-days': { type: 'string' },
        name: { type: 'string' },
        'redirect-uri': { type: 'string', multiple: true },
        'client-id': { type: 'string' },
      },
    })
    const isMisplaced = Object.keys(values).some(
      (name) => OPTION_COMMANDS[name] !== undefined && !OPTION_COMMANDS[name].includes(action),
    )
    if (isMisplaced) return undefined
    const connectionId = values.connection ?? CONNECTOR_DEFAULT_CONNECTION
    // The name becomes file paths in the store; nothing else may reach them.
    if (!connectorConnectionIdSchema.safeParse(connectionId).success) return undefined
    switch (action) {
      case 'serve': {
        return { kind: 'serve', connectionId }
      }
      case 'serve-http': {
        const port = portOf(values.port)
        const minutes = wholeOf(values['token-minutes'])
        const days = wholeOf(values['sign-in-days'])
        if (
          port === undefined ||
          (minutes === undefined && values['token-minutes'] !== undefined) ||
          (days === undefined && values['sign-in-days'] !== undefined)
        ) {
          return undefined
        }
        return {
          kind: 'serveHttp',
          connectionId,
          port,
          bind: values.bind ?? 'loopback',
          tlsCert: values['tls-cert'],
          tlsKey: values['tls-key'],
          isTunnel: values.tunnel === true,
          publicUrl: values['public-url'],
          allowOpenRegistration: values['open-registration'] === true,
          accessTokenMinutes: minutes,
          signInDays: days,
        }
      }
      case 'client-add': {
        const redirectUris = values['redirect-uri'] ?? []
        if (redirectUris.length === 0) return undefined
        return {
          kind: 'clientAdd',
          connectionId,
          name: values.name ?? '',
          redirectUris,
          scopes: values.scope ?? [],
        }
      }
      case 'client-list': {
        return { kind: 'clientList', connectionId }
      }
      case 'client-remove': {
        return values['client-id'] === undefined
          ? undefined
          : { kind: 'clientRemove', connectionId, clientId: values['client-id'] }
      }
      case 'grant': {
        const workspaces = values.workspace ?? []
        if (workspaces.length === 0 && values['user-library'] !== true) return undefined
        return {
          kind: 'grant',
          connectionId,
          workspaces,
          scopes: values.scope ?? [],
          content: values.content === true,
          userLibrary: values['user-library'] === true,
        }
      }
      case 'revoke': {
        return { kind: 'revoke', connectionId }
      }
      case 'kill':
      case 'resume':
      case 'status': {
        return values.connection === undefined ? { kind: action } : undefined
      }
      case 'help': {
        return { kind: 'usage' }
      }
      default: {
        return undefined
      }
    }
  } catch {
    // A malformed option is never echoed: it could be a pasted credential.
    return undefined
  }
}

export interface CommandIo {
  readonly isInteractive: boolean
  readonly confirm: (question: string) => Promise<boolean>
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
  readonly now: () => number
}

async function workspaceGrant(folder: string, hasContent: boolean) {
  const root = await realpath(path.resolve(folder))
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error(folder)
  return {
    id: `ws-${createHash('sha256').update(root).digest('hex').slice(0, WORKSPACE_ID_HEX)}`,
    root,
    label: path.basename(root) || root,
    content: hasContent,
  }
}

function summary(grant: ConnectorGrant): string {
  const workspaces = grant.workspaces.map((workspace) => `${workspace.id} ${workspace.root}`)
  return [
    grant.scopes.join(', '),
    ...workspaces,
    ...(grant.userLibrary ? ['user library'] : []),
  ].join('; ')
}

async function grant(
  store: ConnectorStore,
  command: Extract<ConnectorCommand, { kind: 'grant' }>,
  io: CommandIo,
): Promise<number> {
  if (!io.isInteractive) {
    io.printError(UI_TEXT.acpConnector.grantNeedsTerminal)
    return EXIT_FAILED
  }
  const requested = command.scopes.length === 0 ? DEFAULT_SCOPES : command.scopes
  const known: readonly string[] = CONNECTOR_SCOPES
  const unknown = requested.filter((scope) => !known.includes(scope))
  // Paid authority stays zero until our UI can enable it (Q-M124.4).
  if (unknown.length > 0 || requested.includes('paid:request')) {
    io.printError(
      fill(UI_TEXT.acpConnector.grantInvalid, {
        reason: [...unknown, ...requested.filter((scope) => scope === 'paid:request')].join(', '),
      }),
    )
    return EXIT_USAGE
  }
  const scopes = CONNECTOR_SCOPES.filter(
    (scope) => requested.includes(scope) || (scope === 'content:read' && command.content),
  )
  let workspaces
  try {
    workspaces = await Promise.all(
      command.workspaces.map((folder) => workspaceGrant(folder, command.content)),
    )
  } catch {
    io.printError(fill(UI_TEXT.acpConnector.grantInvalid, { reason: 'workspace' }))
    return EXIT_USAGE
  }
  const previous = await store.grant(command.connectionId)
  const next = connectorGrantSchema.safeParse({
    schemaVersion: CONNECTOR_SCHEMA_VERSION,
    connectionId: command.connectionId,
    generation: (previous?.generation ?? 0) + 1,
    createdAt: new Date(io.now()).toISOString(),
    revoked: false,
    scopes: grantScopes(scopes),
    userLibrary: command.userLibrary,
    paidCapMicrousd: 0,
    workspaces,
  })
  if (!next.success) {
    io.printError(fill(UI_TEXT.acpConnector.grantInvalid, { reason: 'connection' }))
    return EXIT_USAGE
  }
  const question = fill(UI_TEXT.acpConnector.grantConfirm, {
    connection: command.connectionId,
    summary: summary(next.data),
  })
  if (!(await io.confirm(question))) {
    io.printError(UI_TEXT.acpConnector.notConfirmed)
    return EXIT_FAILED
  }
  await store.saveGrant(next.data)
  await controlReceipt(store, io, command.connectionId, 'grant', next.data.generation)
  io.print(
    fill(UI_TEXT.acpConnector.grantSaved, {
      connection: command.connectionId,
      workspaces: workspaces.map((workspace) => `${workspace.id} (${workspace.label})`).join(', '),
    }),
  )
  return 0
}

/** The local owner's commands; serving and the OAuth commands have their own entries. */
export type LocalConnectorCommand = Exclude<
  ConnectorCommand,
  { kind: 'serve' | 'serveHttp' | 'clientAdd' | 'clientList' | 'clientRemove' }
>

export async function runConnectorCommand(
  store: ConnectorStore,
  command: LocalConnectorCommand,
  io: CommandIo,
): Promise<number> {
  switch (command.kind) {
    case 'grant': {
      return await grant(store, command, io)
    }
    case 'revoke': {
      const current = await store.grant(command.connectionId)
      if (current === undefined) {
        io.print(UI_TEXT.acpConnector.noGrants)
        return 0
      }
      await store.saveGrant({ ...current, revoked: true, generation: current.generation + 1 })
      await controlReceipt(store, io, command.connectionId, 'revoke', current.generation + 1)
      io.print(fill(UI_TEXT.acpConnector.revoked, { connection: command.connectionId }))
      return 0
    }
    case 'kill': {
      await store.setKilled(true, new Date(io.now()).toISOString())
      await controlReceipt(store, io, OWNER_JOURNAL, 'kill')
      io.print(UI_TEXT.acpConnector.killOn)
      return 0
    }
    case 'resume': {
      if (!io.isInteractive) {
        io.printError(UI_TEXT.acpConnector.grantNeedsTerminal)
        return EXIT_FAILED
      }
      if (!(await io.confirm(`${UI_TEXT.acpConnector.killOff} (y/N)`))) {
        io.printError(UI_TEXT.acpConnector.notConfirmed)
        return EXIT_FAILED
      }
      await store.setKilled(false, new Date(io.now()).toISOString())
      await controlReceipt(store, io, OWNER_JOURNAL, 'resume')
      io.print(UI_TEXT.acpConnector.killOff)
      return 0
    }
    case 'status': {
      io.print(
        (await store.isKilled()) ? UI_TEXT.acpConnector.statusOff : UI_TEXT.acpConnector.statusOn,
      )
      const grants = await store.grants()
      if (grants.length === 0) io.print(UI_TEXT.acpConnector.noGrants)
      for (const current of grants) {
        io.print(
          fill(UI_TEXT.acpConnector.statusGrant, {
            connection: current.connectionId,
            revoked: current.revoked ? UI_TEXT.acpConnector.statusRevoked : '',
            scopes: current.scopes.join(', '),
          }),
        )
        for (const workspace of current.workspaces)
          io.print(
            fill(UI_TEXT.acpConnector.statusWorkspace, {
              id: workspace.id,
              root: workspace.root,
              content: workspace.content ? UI_TEXT.acpConnector.statusContent : '',
            }),
          )
      }
      return 0
    }
    case 'usage': {
      io.print(UI_TEXT.acpConnector.usage)
      return 0
    }
  }
}

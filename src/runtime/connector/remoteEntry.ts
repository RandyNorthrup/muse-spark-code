// M124 remote (D217): dist/connectorRemote.js, loaded only by
// `muse-spark-code-acp mcp serve-http` and `mcp client …`. The server runs
// on the person's own PC and nowhere else: loopback unless they name a wider
// address, their own certificate (or their own tunnel in front, which ends
// TLS), and — when a tunnel or proxy of theirs fronts it — their own public
// URL as the issuer. Nothing here contacts a service of ours, and no model
// call, key access or provider request happens because a client connects.
import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { createInterface } from 'node:readline/promises'
import path from 'node:path'
import {
  CONNECTOR_FOLDER,
  CONNECTOR_REMOTE_LIMITS,
  CONNECTOR_REMOTE_PATHS,
  SECONDS_PER_DAY,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import { CONNECTOR_SCOPES, type ConnectorScope } from '../../shared/connector'
import { isAllowedRedirectUri } from '../../shared/connectorRemote'
import type { UiText } from '../../shared/l10n/en'
import { fill, setUiText } from '../../shared/l10n/text'
import { causeForLog } from '../../core/backends/musecode/logText'
import { isRemoteCommand, parseConnectorCommand, type ConnectorCommand } from './command'
import type { ConnectorRuntimeDeps } from './entry'
import { startConnectorHttp } from './http'
import { addOwnerClient, endClient, ownerClients } from './oauth/clients'
import { ConnectorOAuth } from './oauth/server'
import { registryHostFor, sharedWatchAuthority } from './registryHost'
import { ConnectorStore, isOAuthStateUnreadable } from './store'
import { isStorageRefused } from './storageGuardPort'

const EXIT_USAGE = 2
const EXIT_FAILED = 1
const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(['127.0.0.1', '::1'])
/** What `isIP` answers for an IPv6 address. */
const IP_VERSION_6 = 6

type ServeHttp = Extract<ConnectorCommand, { kind: 'serveHttp' }>
type ClientCommand = Extract<
  ConnectorCommand,
  { kind: 'clientAdd' | 'clientList' | 'clientRemove' }
>
type RemoteText = UiText['acpConnectorRemote']

interface Reach {
  /** The interface address to listen on. */
  readonly host: string
  /** The origin clients use to reach this PC; the issuer. */
  readonly issuer: string
}

type ReachVerdict =
  | { readonly kind: 'ok'; readonly reach: Reach }
  | {
      readonly kind: 'refused'
      readonly sentence: 'needsPublicUrl' | 'needsHttps' | 'tunnelNeedsLoopback'
    }

/** The listen address, from `loopback`, `lan` or an address of this PC's own. */
function listenAddress(bind: string): string | undefined {
  if (bind === 'loopback') return '127.0.0.1'
  if (bind === 'lan') return '0.0.0.0'
  return isIP(bind) === 0 ? undefined : bind
}

/** A public URL is an https origin and nothing more: no path, query, fragment or credentials. */
function publicOrigin(text: string): string | undefined {
  if (!URL.canParse(text)) return undefined
  const url = new URL(text)
  const isBare = url.pathname === '/' && url.search === '' && url.hash === ''
  return isBare && url.protocol === 'https:' && url.username === '' && url.password === ''
    ? url.origin
    : undefined
}

/**
Where the server listens and what clients call it. Nothing listens beyond
loopback unless the person said so, and a plain-HTTP listener exists only on
loopback behind their own tunnel.
*/
function reachOf(command: ServeHttp, host: string): ReachVerdict {
  const isLoopback = LOOPBACK_ADDRESSES.has(host)
  const hasTls = command.tlsCert !== undefined && command.tlsKey !== undefined
  if (command.isTunnel) {
    if (command.tlsCert !== undefined || command.tlsKey !== undefined) {
      return { kind: 'refused', sentence: 'needsHttps' }
    }
    if (!isLoopback) return { kind: 'refused', sentence: 'tunnelNeedsLoopback' }
  } else if (!hasTls) {
    return { kind: 'refused', sentence: 'needsHttps' }
  }
  if (command.publicUrl !== undefined) {
    const origin = publicOrigin(command.publicUrl)
    return origin === undefined
      ? { kind: 'refused', sentence: 'needsPublicUrl' }
      : { kind: 'ok', reach: { host, issuer: origin } }
  }
  // A tunnel names itself; an address that reaches every interface names nothing.
  if (host === '0.0.0.0' || host === '::' || command.isTunnel) {
    return { kind: 'refused', sentence: 'needsPublicUrl' }
  }
  const named = isIP(host) === IP_VERSION_6 ? `[${host}]` : host
  return { kind: 'ok', reach: { host, issuer: `https://${named}:${String(command.port)}` } }
}

/** A filesystem failure with its OS code: the person's file to fix, not ours. */
function isFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
}

/** The listen failures the person can fix: a taken port, a denied or absent address. */
const LISTEN_ERRORS: ReadonlySet<string> = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL'])

/** The OS refusing the listen itself: a taken port, a denied or absent address. */
function isListenError(error: unknown): boolean {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return typeof code === 'string' && LISTEN_ERRORS.has(code)
}

/** A stored string field; anything else reads as empty. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Resolves when the person stops the connector: Ctrl+C or a termination request. */
function personStops(): Promise<void> {
  return new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
}

async function runClientCommand(
  deps: ConnectorRuntimeDeps,
  command: ClientCommand,
  store: ConnectorStore,
  text: RemoteText,
  line: (words: string) => void,
): Promise<number> {
  const authority = store.authority(command.connectionId)
  await authority.refresh()
  if (command.kind === 'clientList') {
    const owner = await ownerClients(store, command.connectionId)
    // Clients that registered themselves and were approved, as the server saved them.
    const server = await store.oauthState(command.connectionId)
    const approved = new Set(
      (server?.records ?? [])
        .filter((record) => record.model === 'Grant')
        .map((record) => record.payload['clientId']),
    )
    const open = (server?.records ?? []).filter(
      (record) =>
        record.model === 'Client' &&
        approved.has(record.key) &&
        !owner.revoked.includes(record.key),
    )
    if (owner.clients.length === 0 && open.length === 0) line(text.noClients)
    for (const client of owner.clients) {
      if (owner.revoked.includes(client.clientId)) continue
      line(
        fill(text.clientRow, {
          clientId: client.clientId,
          name: client.clientName,
          kind: text.clientKindOwner,
          redirects: client.redirectUris.join(', '),
          scopes: client.scopes.join(' '),
        }),
      )
    }
    for (const client of open) {
      const redirects = client.payload['redirect_uris']
      line(
        fill(text.clientRow, {
          clientId: client.key,
          name: textOf(client.payload['client_name']),
          kind: text.clientKindOpen,
          redirects: Array.isArray(redirects) ? redirects.join(', ') : '',
          scopes: textOf(client.payload['scope']),
        }),
      )
    }
    return 0
  }
  if (command.kind === 'clientRemove') {
    const isEnded = (await endClient(store, command.connectionId, command.clientId)) === 'ended'
    line(fill(isEnded ? text.clientRemoved : text.clientNotFound, { clientId: command.clientId }))
    return isEnded ? 0 : EXIT_FAILED
  }
  if (!deps.isInteractive) {
    line(deps.table.acpConnector.grantNeedsTerminal)
    return EXIT_FAILED
  }
  const grant = authority.current().grant
  if (grant === undefined || grant.revoked) {
    line(fill(text.clientInvalid, { reason: 'grant' }))
    return EXIT_FAILED
  }
  // Paid authority is zero in every grant, so no client is offered it.
  const known: readonly string[] = CONNECTOR_SCOPES
  const refused = [
    ...command.scopes.filter(
      (scope) => !known.includes(scope) || grant.scopes.every((granted) => granted !== scope),
    ),
    ...command.redirectUris.filter((uri) => !isAllowedRedirectUri(uri)),
  ]
  if (refused.length > 0) {
    line(fill(text.clientInvalid, { reason: refused.join(', ') }))
    return EXIT_USAGE
  }
  const input = createInterface({ input: deps.stdin, output: deps.stderr })
  let isConfirmed = false
  try {
    const answer = await input.question(
      `${fill(text.clientConfirm, { name: command.name, redirects: command.redirectUris.join(', ') })} `,
    )
    isConfirmed = answer.trim().toLowerCase() === 'y'
  } catch (error: unknown) {
    // Ctrl+C or Ctrl+D at the prompt is a no; anything else is real.
    if (!(error instanceof Error && 'code' in error && error.code === 'ABORT_ERR')) throw error
  } finally {
    input.close()
  }
  if (!isConfirmed) {
    line(deps.table.acpConnector.notConfirmed)
    return EXIT_FAILED
  }
  const scopes: ConnectorScope[] =
    command.scopes.length === 0
      ? [...grant.scopes]
      : grant.scopes.filter((granted) => command.scopes.includes(granted))
  const client = await addOwnerClient(
    store,
    command.connectionId,
    { clientName: command.name, redirectUris: command.redirectUris, scopes },
    Date.now,
  )
  if (client === undefined) {
    line(fill(text.clientInvalid, { reason: 'redirect-uri' }))
    return EXIT_USAGE
  }
  line(fill(text.clientSaved, { clientId: client.clientId }))
  return 0
}

async function runServe(
  deps: ConnectorRuntimeDeps,
  command: ServeHttp,
  reach: Reach,
  store: ConnectorStore,
  text: RemoteText,
  line: (words: string) => void,
  stop: Promise<void>,
): Promise<number> {
  let tls: { cert: string; key: string } | undefined
  if (command.tlsCert !== undefined && command.tlsKey !== undefined) {
    try {
      tls = {
        cert: await readFile(command.tlsCert, 'utf8'),
        key: await readFile(command.tlsKey, 'utf8'),
      }
    } catch (error: unknown) {
      // A file that is missing or unreadable is the person's to fix.
      if (!isFileError(error)) throw error
      line(fill(text.tlsUnreadable, { file: command.tlsCert }))
      return EXIT_FAILED
    }
  }
  await store.prepareAudit(command.connectionId)
  const authority = store.authority(command.connectionId)
  await authority.refresh()
  const oauth = await ConnectorOAuth.create({
    store,
    connectionId: command.connectionId,
    issuer: reach.issuer,
    authority,
    now: Date.now,
    allowOpenRegistration: command.allowOpenRegistration,
    accessTokenTtlSeconds:
      command.accessTokenMinutes === undefined
        ? CONNECTOR_REMOTE_LIMITS.accessTokenSeconds
        : command.accessTokenMinutes * SECONDS_PER_MINUTE,
    signInTtlSeconds:
      command.signInDays === undefined
        ? CONNECTOR_REMOTE_LIMITS.grantTtlSeconds
        : command.signInDays * SECONDS_PER_DAY,
    isBehindTls: command.isTunnel,
    onOwnerCode: (code) => {
      line(fill(text.ownerCodeLine, { code }))
    },
  })
  const host = registryHostFor(deps, command.connectionId, store)
  let server
  try {
    server = await startConnectorHttp({
      host: reach.host,
      port: command.port,
      tls,
      issuer: reach.issuer,
      oauth,
      registries: host,
      authority: sharedWatchAuthority(authority),
      onError: (error) => {
        line(fill(text.requestFailed, { cause: causeForLog(error) }))
      },
    })
  } catch (error: unknown) {
    // Only a port or address the OS refuses is the person's to fix.
    if (!isListenError(error)) throw error
    line(fill(text.listenFailed, { bind: command.bind, port: String(command.port) }))
    return EXIT_FAILED
  }
  line(fill(text.listening, { url: `${reach.issuer}${CONNECTOR_REMOTE_PATHS.mcp}` }))
  if (!LOOPBACK_ADDRESSES.has(reach.host)) line(fill(text.reachNotice, { bind: command.bind }))
  try {
    await stop
    return 0
  } finally {
    await server.close()
    await host.close()
  }
}

/**
Runs the HTTPS connector or one of its client commands. `stop` ends serving;
the default waits for the person's Ctrl+C.
*/
export async function runConnectorRemote(
  deps: ConnectorRuntimeDeps,
  stop: Promise<void> = personStops(),
): Promise<number> {
  setUiText(deps.table, deps.locale)
  const text = deps.table.acpConnectorRemote
  const line = (words: string): void => {
    deps.stderr.write(`${words}\n`)
  }
  const command = parseConnectorCommand(deps.argv)
  if (command === undefined || !isRemoteCommand(command)) {
    line(deps.table.acpConnector.usage)
    return EXIT_USAGE
  }
  let reach: Reach | undefined
  if (command.kind === 'serveHttp') {
    const host = listenAddress(command.bind)
    const verdict = host === undefined ? undefined : reachOf(command, host)
    if (verdict === undefined) {
      line(deps.table.acpConnector.usage)
      return EXIT_USAGE
    }
    if (verdict.kind === 'refused') {
      line(text[verdict.sentence])
      return EXIT_USAGE
    }
    reach = verdict.reach
  }
  const store = new ConnectorStore(deps.dataFolder, deps.storageGuard)
  try {
    await deps.storageGuard.verify()
    if (command.kind === 'serveHttp') {
      return reach === undefined
        ? EXIT_USAGE
        : await runServe(deps, command, reach, store, text, line, stop)
    }
    return await runClientCommand(deps, command, store, text, line)
  } catch (error: unknown) {
    if (isStorageRefused(error)) {
      line(
        fill(deps.table.acpConnector.storageRefused, {
          folder: path.join(deps.dataFolder, CONNECTOR_FOLDER),
        }),
      )
      return EXIT_FAILED
    }
    // A stored OAuth file that cannot be read refuses with its sentence.
    if (isOAuthStateUnreadable(error)) {
      line(text.stateUnreadable)
      return EXIT_FAILED
    }
    throw error
  }
}

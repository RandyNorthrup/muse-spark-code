// M124 remote (D240): the clients the owner registers, and the sign-ins the
// owner ends, in the owner's own file (never the running server's). The
// owner's commands write it; the server reads it afresh whenever it looks a
// client up or checks a token, so a client added or removed in another
// terminal takes effect at once.
import { randomUUID } from 'node:crypto'
import type { ConnectorScope } from '../../../shared/connector'
import {
  isAllowedRedirectUri,
  type ConnectorOwnerClient,
  type ConnectorOwnerClients,
} from '../../../shared/connectorRemote'
import type { ConnectorStore } from '../store'

export type OwnerClients = ConnectorOwnerClients

export interface OwnerClientInput {
  readonly clientName: string
  readonly redirectUris: readonly string[]
  readonly scopes: readonly ConnectorScope[]
}

async function current(store: ConnectorStore, connectionId: string): Promise<OwnerClients> {
  return (
    (await store.ownerClients(connectionId)) ?? {
      schemaVersion: 1,
      connectionId,
      clients: [],
      revoked: [],
    }
  )
}

/** The owner's registration of a client; undefined when a redirect address is not allowed. */
export async function addOwnerClient(
  store: ConnectorStore,
  connectionId: string,
  input: OwnerClientInput,
  now: () => number,
): Promise<ConnectorOwnerClient | undefined> {
  if (input.redirectUris.length === 0 || !input.redirectUris.every(isAllowedRedirectUri)) {
    return undefined
  }
  const client: ConnectorOwnerClient = {
    clientId: randomUUID(),
    clientName: input.clientName,
    redirectUris: [...input.redirectUris],
    scopes: [...input.scopes],
    createdAt: new Date(now()).toISOString(),
  }
  const before = await current(store, connectionId)
  await store.saveOwnerClients({ ...before, clients: [...before.clients, client] })
  return client
}

export type ClientEnd = 'ended' | 'already'

/**
Ends a client's sign-ins: it is removed if the owner registered it, and its
id is revoked either way (an open registration or a metadata-document client
has no entry to remove). `already` when the id was revoked before.
*/
export async function endClient(
  store: ConnectorStore,
  connectionId: string,
  clientId: string,
): Promise<ClientEnd> {
  const before = await current(store, connectionId)
  if (before.revoked.includes(clientId)) return 'already'
  await store.saveOwnerClients({
    ...before,
    clients: before.clients.filter((client) => client.clientId !== clientId),
    revoked: [...before.revoked, clientId],
  })
  return 'ended'
}

export async function ownerClients(
  store: ConnectorStore,
  connectionId: string,
): Promise<OwnerClients> {
  return await current(store, connectionId)
}

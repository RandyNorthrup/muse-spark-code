// M124 remote (D240): `oidc-provider`'s storage port, backed by the
// connector's own records (records.ts). One adapter per model name; the
// library calls these for every code, token, grant, session and client it
// keeps.
import type { Adapter } from 'oidc-provider'
import type { OAuthRecords } from './records'

export function connectorAdapter(records: OAuthRecords): (name: string) => Adapter {
  return (name) => ({
    upsert: async (id, payload, expiresIn) => {
      await records.upsert(name, id, { ...payload }, expiresIn)
    },
    find: async (id) => await records.find(name, id),
    findByUid: (uid) => Promise.resolve(records.findByUid(uid)),
    // The device flow is not enabled: no user code is ever issued.
    findByUserCode: () => Promise.resolve(undefined),
    consume: async (id) => {
      await records.consume(name, id)
    },
    destroy: async (id) => {
      await records.destroy(name, id)
    },
    revokeByGrantId: async (grantId) => {
      await records.revokeByGrantId(grantId)
    },
  })
}

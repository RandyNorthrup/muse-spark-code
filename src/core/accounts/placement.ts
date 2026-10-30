// D-K-W-PLACEMENT: the routing layer's placement store bound to K's account
// store. Pins live on the account rows (`device` in providers.json); a row
// without one reads as this machine, so legacy rows need no migration and
// the existing default account initializes local without a write. All pin
// writes run through K's mutation queue (AccountStore.pin), which enforces
// the one-per-device rule per row; the routing layer's check backstops it
// and fences generations and unknown devices at every send.
import { createHash } from 'node:crypto'
import { ACCOUNT_DEFAULT_ID, DEVICE_LIMITS } from '../../shared/constants'
import { AccountPlacements, type AccountPlacementStore } from '../team/remotePool'
import type { AccountStore, AccountsMetadataPort } from '../providers/accounts'

/** Local profile devices read `local-<profile>` (LocalDeveloperProfiles). */
export const PROFILE_DEVICE_PREFIX = 'local-'

/**
A stable local id without pairing or I/O: this client's own device. Paired
peers use M100's ids; profile devices use `local-<profile>`.
*/
export function localPlacementId(dataDir: string): string {
  return createHash('sha256').update(dataDir).digest('hex').slice(0, DEVICE_LIMITS.idChars)
}

export function isProfileDevice(device: string): boolean {
  return device.startsWith(PROFILE_DEVICE_PREFIX)
}

/** The default local registry: this device plus syntactic profile devices. */
export function localPlacementDeviceMatcher(localDevice: string): (device: string) => boolean {
  return (device) => device === localDevice || isProfileDevice(device)
}

export function placementStoreFromAccountStore(deps: {
  readonly store: AccountStore
  readonly listProviders: () => Promise<readonly string[]> | readonly string[]
  readonly localDevice: string
}): AccountPlacementStore {
  return {
    read: async () => {
      const rows = []
      const providers = await deps.listProviders()
      for (const provider of providers) {
        const listed = await deps.store.list(provider)
        for (const row of listed)
          rows.push({
            provider,
            account: row.id,
            device: row.device ?? deps.localDevice,
          })
      }
      return rows
    },
    write: async (rows, check) => {
      check()
      // ES2023: no Map.groupBy on the Node 20 host, so the loop stays.
      const byProvider = new Map<string, { provider: string; account: string; device: string }[]>()
      for (const row of rows) {
        const group = byProvider.get(row.provider)
        if (group === undefined) byProvider.set(row.provider, [row])
        else group.push(row)
      }
      for (const [provider, group] of byProvider) {
        const current = await deps.store.list(provider)
        for (const row of group) {
          const found = current.find((entry) => entry.id === row.account)
          // A concurrent removal wins over this pin: pinning a missing row
          // refuses as an unknown account rather than resurrecting it.
          if (found === undefined || (found.device ?? deps.localDevice) !== row.device)
            await deps.store.pin(provider, row.account, row.device)
        }
      }
    },
  }
}

/**
One placement owner per account-services profile. `isKnownDevice` joins the
paired-device/node registry (editor) or the local default (terminal); a
metadata failure reads as unknown, so routing refuses instead of admitting
an unverified pin.
*/
export function createAccountPlacements(deps: {
  readonly store: AccountStore
  readonly metadata: AccountsMetadataPort
  readonly listProviders: () => Promise<readonly string[]> | readonly string[]
  readonly localDevice: string
  readonly isKnownDevice: (device: string) => boolean
  readonly isOnePerDevice: () => boolean
}): AccountPlacements {
  return new AccountPlacements({
    store: placementStoreFromAccountStore(deps),
    isKnown: (placement) => {
      try {
        const entry =
          deps.metadata.readNow === undefined
            ? undefined
            : deps.metadata.readNow(placement.provider)
        if (entry === undefined) return false
        const rows: readonly { id: string }[] = entry.accounts ?? [{ id: ACCOUNT_DEFAULT_ID }]
        return (
          rows.some((row) => row.id === placement.account) && deps.isKnownDevice(placement.device)
        )
      } catch {
        return false
      }
    },
    onePerDevicePerProvider: deps.isOnePerDevice,
  })
}

// The node dials home when its own addresses change (M110r Y2, PLAN.md
// D90.25). Node's runtime reports no interface-change event, so the
// watcher polls the interfaces and reports the added and removed
// external addresses; the node then reconnects outbound to every pair at
// once with its new addresses inside the channel. The poll only notices;
// it never stops work.

import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { compareStrings } from '../../shared/canonicalJson'
import { NODE_ADDRESS_POLL_MS } from '../../shared/constants'

/** The node's external addresses: no loopback, no internal, sorted. */
export function snapshotAddresses(
  list: () => Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces,
): readonly string[] {
  const addresses = new Set<string>()
  const families = Object.values(list())
  for (const infos of families) {
    const family = infos ?? []
    for (const info of family) {
      if (!info.internal) addresses.add(info.address)
    }
  }
  return [...addresses].toSorted(compareStrings)
}

/** What changed between two snapshots: added and removed addresses. */
export interface AddressChange {
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

/** Diff two snapshots; empty when nothing changed. */
export function diffAddresses(before: readonly string[], after: readonly string[]): AddressChange {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return {
    added: after.filter((address) => !beforeSet.has(address)),
    removed: before.filter((address) => !afterSet.has(address)),
  }
}

export interface NetWatchOptions {
  readonly pollMs?: number | undefined
  readonly list?: (() => Record<string, NetworkInterfaceInfo[] | undefined>) | undefined
  readonly onChange: (change: AddressChange, current: readonly string[]) => void
}

/**
Poll the interfaces every `pollMs` and call `onChange` with each real
change. Returns the stop function; the timer never keeps the process
alive. The first snapshot is silent: only changes report.
*/
export function watchAddresses(options: NetWatchOptions): () => void {
  const pollMs = options.pollMs ?? NODE_ADDRESS_POLL_MS
  const list = options.list ?? networkInterfaces
  let current = snapshotAddresses(list)
  const timer = setInterval(() => {
    const next = snapshotAddresses(list)
    const change = diffAddresses(current, next)
    current = next
    if (change.added.length > 0 || change.removed.length > 0) {
      options.onChange(change, next)
    }
  }, pollMs)
  timer.unref()
  return () => {
    clearInterval(timer)
  }
}

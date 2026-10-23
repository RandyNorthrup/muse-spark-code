// The headless cleanup ledger's cross-process lease (M96b), loaded on the
// first ledger turn (dist/execLedgerLease.js) so dist/execTeam.js stays
// inside its budget: the fenced file lease is M123's primitive, reached
// through the Node lease port, and one folder's turn at a time runs under
// it in every process.
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { acquireFileLease, type FileLeaseEnv } from '../../core/locks/fileLease'
import { nodeLeasePort } from '../../core/locks/nodeLeasePort'
import { currentProcessOwner, isProcessOwnerGone } from '../../core/locks/processOwner'
import {
  EXEC_TEAM_LEDGER_LEASE_MS,
  EXEC_TEAM_LEDGER_LEASE_POLL_MS,
  EXEC_TEAM_LEDGER_LEASE_TIMEOUT_MS,
  EXEC_TEAM_LEDGER_LEASE_UNREADABLE_MS,
  EXEC_TEAM_LEDGER_LOCK_FILE,
} from '../../shared/constants'

// Holder object (the `setUiText` shape): the cached environment mutates
// the holder, never a top-level binding.
const ledgerLeaseEnvState: { env?: Promise<FileLeaseEnv> } = {}

async function makeLedgerLeaseEnv(): Promise<FileLeaseEnv> {
  return {
    port: nodeLeasePort,
    now: () => Date.now(),
    monotonic: () => performance.now(),
    sleep: (ms: number) => delay(ms),
    owner: await currentProcessOwner(),
    isOwnerGone: (owner) => isProcessOwnerGone(owner),
    leaseMs: EXEC_TEAM_LEDGER_LEASE_MS,
    honoredLeaseMs: EXEC_TEAM_LEDGER_LEASE_MS,
    unreadableMs: EXEC_TEAM_LEDGER_LEASE_UNREADABLE_MS,
    timeoutMs: EXEC_TEAM_LEDGER_LEASE_TIMEOUT_MS,
    pollMs: EXEC_TEAM_LEDGER_LEASE_POLL_MS,
  }
}

function leaseEnvOf(): Promise<FileLeaseEnv> {
  ledgerLeaseEnvState.env ??= makeLedgerLeaseEnv()
  return ledgerLeaseEnvState.env
}

/** One ledger turn under the folder's cross-process lease; busy refuses loudly. */
export async function withExecLedgerLease<T>(folder: string, work: () => Promise<T>): Promise<T> {
  const lease = await acquireFileLease(
    path.join(folder, EXEC_TEAM_LEDGER_LOCK_FILE),
    await leaseEnvOf(),
  )
  try {
    return await work()
  } finally {
    await lease.release()
  }
}

import { createHash } from 'node:crypto'
import { DEVELOPER_MACHINE_ID_DOMAIN } from '../../shared/constants'

/** The one machine identity every host shares (DEVID017, PLAN.md D88). The
 * extension host, the CLI/ACP runtime and the companion derive it from the
 * same operating-system hostname, so an unlock in one is honoured in the
 * others. The stored id is a hash, never the raw hostname: hostnames hold
 * dots (`name.local`), which the state schema rejects, and leak LAN and
 * domain names into stored state. Hostnames compare case-insensitively, so
 * the derivation lowercases before hashing. */
export function developerMachineId(hostname: string): string {
  const normalized = hostname.trim().toLowerCase()
  return createHash('sha256').update(`${DEVELOPER_MACHINE_ID_DOMAIN}:${normalized}`).digest('hex')
}

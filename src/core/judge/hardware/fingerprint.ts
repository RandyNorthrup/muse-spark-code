// M125 lane H (D107): the hardware fingerprint. A stable hash of what
// the recommendation depends on — platform, CPU, memory, GPU class —
// so a changed machine shows Re-scan. Capacities only: no serials,
// names beyond the CPU model, or paths enter the hash.
import { createHash } from 'node:crypto'
import type { HardwareSummary } from './types'

/** The fingerprint input: architectures and capacities, nothing personal. */
export function fingerprintInput(summary: HardwareSummary): readonly (string | number)[] {
  return [
    summary.os,
    summary.arch,
    summary.cpu.model,
    summary.cpu.cores,
    summary.ramBytes,
    summary.gpu.vendor,
    summary.gpu.backend,
    summary.gpu.vramBytes ?? -1,
  ]
}

/** The scan's stable identity, hex SHA-256 over the fingerprint input. */
export function hardwareFingerprint(summary: HardwareSummary): string {
  return createHash('sha256')
    .update(JSON.stringify(fingerprintInput(summary)))
    .digest('hex')
}

import { createHash, randomBytes } from 'node:crypto'
import { link, mkdir, open, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import {
  DEVELOPER_DIRECTORY_MODE,
  DEVELOPER_FILE_MODE,
  DEVELOPER_MACHINE_ID_BYTES,
  DEVELOPER_MACHINE_ID_DOMAIN,
  DEVELOPER_MACHINE_ID_FILE,
  DEVELOPER_MACHINE_ID_READ_ATTEMPTS,
  DEVELOPER_MACHINE_ID_READ_DELAY_MS,
  DEVELOPER_MACHINE_ID_TMP_PID_RADIX,
  DEVELOPER_MACHINE_ID_TMP_SUFFIX_BYTES,
} from '../../shared/constants'
import { DeveloperOptionsError } from './developerOptions'

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** The machine identity file every host on this machine shares (DEVID017B,
 * PLAN.md D88): `<dataDir>/machine-id`, beside the runtime's other
 * machine-scoped files. The extension host resolves the same folder through
 * `agentDataFolder`, so either host honours the other's unlock. */
export function developerMachineIdFile(dataDir: string): string {
  return path.join(dataDir, DEVELOPER_MACHINE_ID_FILE)
}

function isPublishedMachineId(value: string): boolean {
  // The exact publication format only: 64 lowercase hex characters with one
  // optional trailing newline. A partial prefix, garbage or a short value
  // is unreadable, never an identity.
  return /^[0-9a-f]{64}\n?$/.test(value)
}

/** Read a published id, waiting briefly for a racing creator to finish. */
async function readPublishedMachineId(file: string): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      throw new DeveloperOptionsError('unavailable')
    }
    if (isPublishedMachineId(text)) return text.endsWith('\n') ? text.slice(0, -1) : text
    if (attempt >= DEVELOPER_MACHINE_ID_READ_ATTEMPTS)
      throw new DeveloperOptionsError('unavailable')
    await pause(DEVELOPER_MACHINE_ID_READ_DELAY_MS)
  }
}

/** Load the machine's stable id, creating it once (DEVID017B, redesigned
 * DEVID017C, read-first DEVID017D). An already published id is returned
 * before any staging, so read-only storage still loads the identity.
 * Otherwise the full id is staged to a private temp file in the same
 * folder and fsynced, then published atomically and exclusively with
 * `link`, which fails when the final name exists — the calibration
 * journal's (`src/core/estimator/calibration/journal.ts`) claim pattern,
 * which also links on Windows. The temp file is removed afterwards. A
 * reader racing a creator therefore sees no file or the complete id, never
 * a prefix. A missing, unreadable or invalid file refuses honestly; the id
 * is never derived from the hostname, so renames change nothing. */
export async function loadDeveloperMachineId(dataDir: string): Promise<string> {
  const file = developerMachineIdFile(dataDir)
  try {
    await mkdir(dataDir, { recursive: true, mode: DEVELOPER_DIRECTORY_MODE })
  } catch {
    throw new DeveloperOptionsError('unavailable')
  }
  // A published id wins without staging anything: storage that refuses new
  // files (permissions or quota) still loads the existing identity instead
  // of refusing. Publish only when the final name is absent or unreadable.
  try {
    return await readPublishedMachineId(file)
  } catch {
    // Absent, unreadable or invalid: fall through to publish below. An
    // invalid file stays refused by the readers on every path.
  }
  const fresh = randomBytes(DEVELOPER_MACHINE_ID_BYTES).toString('hex')
  const temporary = path.join(
    dataDir,
    `${DEVELOPER_MACHINE_ID_FILE}.${process.pid.toString(DEVELOPER_MACHINE_ID_TMP_PID_RADIX)}-${randomBytes(DEVELOPER_MACHINE_ID_TMP_SUFFIX_BYTES).toString('hex')}.tmp`,
  )
  try {
    const staged = await open(temporary, 'wx', DEVELOPER_FILE_MODE)
    try {
      await staged.writeFile(`${fresh}\n`, 'utf8')
      await staged.sync()
    } finally {
      await staged.close()
    }
  } catch {
    // Every staging failure removes its temp file: a failed write, fsync
    // or close must not leave another claim file behind for the next load.
    try {
      await rm(temporary, { force: true })
    } catch {
      // The staging file is already gone; the load still failed honestly.
    }
    throw new DeveloperOptionsError('unavailable')
  }
  try {
    await link(temporary, file)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    // Another creator published first: its id is authoritative, never ours.
    if (!hasCode(error, 'EEXIST')) throw new DeveloperOptionsError('unavailable')
    return await readPublishedMachineId(file)
  }
  await rm(temporary, { force: true })
  return fresh
}

/** The DEVID017 derivation, kept only to recognise stored state from before
 * DEVID017B, never as the machine's identity: lowercase, domain-separated
 * SHA-256 hex of an operating-system hostname. */
export function legacyDeveloperMachineId(hostname: string): string {
  const normalized = hostname.trim().toLowerCase()
  return createHash('sha256').update(`${DEVELOPER_MACHINE_ID_DOMAIN}:${normalized}`).digest('hex')
}

/** Stored ids this machine may have carried before DEVID017B, compared
 * case-insensitively by `DeveloperOptions.open`: the raw hostname
 * (pre-DEVID017 state), its digest (DEVID017 state), and the digest of its
 * short and `.local` forms, since the OS reports either spelling. */
export function developerMachineIdAliases(hostname: string): readonly string[] {
  const full = hostname.trim().toLowerCase()
  const short = full.split('.', 1)[0] ?? full
  const aliases = new Set<string>([full])
  for (const candidate of [full, short, `${short}.local`])
    aliases.add(legacyDeveloperMachineId(candidate))
  return [...aliases]
}

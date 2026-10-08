import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
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

function isStoredMachineId(value: string): boolean {
  // The same shape the state schema admits
  // (`src/shared/developerOptions.ts`): the stored identity must unlock
  // this machine's state, never fail parsing it.
  return /^[a-zA-Z0-9_-]{1,100}$/.test(value)
}

/** Load the machine's stable id, creating it once (DEVID017B). The first
 * writer wins through an exclusive create, like the repository's other
 * atomic creates (`providersFile.ts`, the calibration journal): racers that
 * lose read the winner's file, waiting briefly for its bytes. A missing,
 * unreadable or invalid file refuses honestly; the id is never derived from
 * the hostname, so renames change nothing. */
export async function loadDeveloperMachineId(dataDir: string): Promise<string> {
  const file = developerMachineIdFile(dataDir)
  try {
    await mkdir(dataDir, { recursive: true, mode: DEVELOPER_DIRECTORY_MODE })
  } catch {
    throw new DeveloperOptionsError('unavailable')
  }
  const fresh = randomBytes(DEVELOPER_MACHINE_ID_BYTES).toString('hex')
  try {
    const handle = await open(file, 'wx', DEVELOPER_FILE_MODE)
    try {
      await handle.writeFile(`${fresh}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    return fresh
  } catch (error: unknown) {
    if (!hasCode(error, 'EEXIST')) throw new DeveloperOptionsError('unavailable')
  }
  for (let attempt = 1; ; attempt += 1) {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      throw new DeveloperOptionsError('unavailable')
    }
    const id = text.trim()
    if (isStoredMachineId(id)) return id
    if (attempt >= DEVELOPER_MACHINE_ID_READ_ATTEMPTS)
      throw new DeveloperOptionsError('unavailable')
    await pause(DEVELOPER_MACHINE_ID_READ_DELAY_MS)
  }
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

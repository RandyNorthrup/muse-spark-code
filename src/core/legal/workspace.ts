import { fill } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
// Read-only filesystem admission for lane S. No links are followed: each
// file is bound to the exact native identity sampled during enumeration,
// opened read-only, and checked again before any bytes are read. Runtime
// and host lanes can share this adapter rather than supply an unsafe reader.
import { bytesFingerprint } from '../verify/fingerprint'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from 'node:fs'
import path from 'node:path'
import {
  LEGAL_DIRECTORY_ENTRIES_MAX,
  LEGAL_FILE_MAX_BYTES,
  LEGAL_TOTAL_MAX_BYTES,
  LEGAL_SCAN_TIMEOUT_MS,
} from '../../shared/constants'
import { sameFile } from '../fs/fileIdentity'
import {
  assertWorkspaceRelative,
  compareLegalText,
  LegalScanError,
  type LegalFileSnapshot,
} from './files'

/** Enumeration errors and omitted subtrees travel with the snapshot. */
export interface LegalWorkspaceSnapshot extends LegalFileSnapshot {
  readonly incompleteChecks: readonly string[]
}

function isWithin(root: string, candidate: string): boolean {
  const local = path.relative(root, candidate)
  return !path.isAbsolute(local) && local !== '..' && !local.startsWith(`..${path.sep}`)
}

/**
 * Admit a bounded, local workspace, excluding links and special files.
 * Reads are UTF-8 only; undecodable/binary material remains incomplete.
 * The directory-entry budget also bounds trees containing only empty dirs.
 */
export function createLegalSnapshot(
  rootPath: string,
  signal?: AbortSignal,
  deadline = Date.now() + LEGAL_SCAN_TIMEOUT_MS,
): LegalWorkspaceSnapshot {
  if (signal?.aborted === true) throw new LegalScanError(UI_TEXT.legalScanner.m111)
  const root = realpathSync(rootPath)
  if (!lstatSync(root).isDirectory()) throw new LegalScanError(UI_TEXT.legalScanner.m137)
  const admitted = new Map<string, BigIntStats>()
  const hashes = new Map<string, string>()
  const incompleteChecks: string[] = []
  let entriesSeen = 0
  let bytesRead = 0
  const cache = new Map<string, string>()
  const isWithinTime = (): boolean => {
    if (Date.now() < deadline) return true
    const message = 'scan stopped at limit: elapsed time'
    if (!incompleteChecks.includes(message)) incompleteChecks.push(message)
    return false
  }
  const checkCancellation = (): void => {
    if (signal?.aborted === true) throw new LegalScanError(UI_TEXT.legalScanner.m111)
  }
  const visit = (directory: string, localDirectory: string): void => {
    checkCancellation()
    if (!isWithinTime()) return
    const before = lstatSync(directory, { bigint: true })
    if (
      before.isSymbolicLink() ||
      !before.isDirectory() ||
      !isWithin(root, realpathSync(directory))
    ) {
      incompleteChecks.push(fill(UI_TEXT.legalScanner.m138, { v0: localDirectory || '.' }))
      return
    }
    const dir = opendirSync(directory)
    const names: string[] = []
    try {
      let entry = dir.readSync()
      while (entry !== null) {
        checkCancellation()
        if (!isWithinTime()) return
        entriesSeen += 1
        if (entriesSeen > LEGAL_DIRECTORY_ENTRIES_MAX) {
          incompleteChecks.push(UI_TEXT.legalScanner.m139)
          return
        }
        names.push(entry.name)
        entry = dir.readSync()
      }
    } finally {
      dir.closeSync()
    }
    if (!sameFile(before, lstatSync(directory, { bigint: true }))) {
      incompleteChecks.push(fill(UI_TEXT.legalScanner.m140, { v0: localDirectory || '.' }))
      return
    }
    const sortedNames = names.toSorted((a, b) => compareLegalText(a, b))
    for (const name of sortedNames) {
      checkCancellation()
      if (entriesSeen > LEGAL_DIRECTORY_ENTRIES_MAX || !isWithinTime()) return
      const local = localDirectory === '' ? name : `${localDirectory}/${name}`
      if (name === '.git') {
        incompleteChecks.push(fill(UI_TEXT.legalScanner.m141, { v0: local }))
        continue
      }
      try {
        assertWorkspaceRelative(local)
        const absolute = path.join(directory, name)
        const sample = lstatSync(absolute, { bigint: true })
        if (sample.isSymbolicLink())
          incompleteChecks.push(fill(UI_TEXT.legalScanner.m142, { v0: local }))
        else if (sample.isDirectory()) visit(absolute, local)
        else if (sample.isFile()) admitted.set(local, sample)
        else incompleteChecks.push(fill(UI_TEXT.legalScanner.m143, { v0: local }))
      } catch (error) {
        if (signal?.aborted === true) throw error
        incompleteChecks.push(fill(UI_TEXT.legalScanner.m144, { v0: local }))
      }
    }
  }
  visit(root, '')
  return {
    files: Array.from(admitted.keys(), (entry) => entry).toSorted((a, b) => compareLegalText(a, b)),
    incompleteChecks,
    readFileHash: (local) => hashes.get(local),
    readFile: (local: string): string | undefined => {
      checkCancellation()
      assertWorkspaceRelative(local)
      if (!isWithinTime()) return undefined
      if (cache.has(local)) return cache.get(local)
      const expected = admitted.get(local)
      if (expected === undefined) return undefined
      let fd: number | undefined
      try {
        const absolute = path.join(root, ...local.split('/'))
        const leaf = lstatSync(absolute, { bigint: true })
        if (
          leaf.isSymbolicLink() ||
          !sameFile(expected, leaf) ||
          !isWithin(root, realpathSync(absolute))
        )
          return undefined
        const flags =
          constants.O_RDONLY |
          (Object.hasOwn(constants, 'O_NOFOLLOW') ? constants.O_NOFOLLOW : 0) |
          (Object.hasOwn(constants, 'O_NONBLOCK') ? constants.O_NONBLOCK : 0)
        fd = openSync(absolute, flags)
        const held = fstatSync(fd, { bigint: true })
        if (!held.isFile() || !sameFile(expected, held) || !isWithin(root, realpathSync(absolute)))
          return undefined
        if (
          held.size > BigInt(LEGAL_FILE_MAX_BYTES) ||
          held.size + BigInt(bytesRead) > BigInt(LEGAL_TOTAL_MAX_BYTES)
        ) {
          incompleteChecks.push(fill(UI_TEXT.legalScanner.m114, { v0: local }))
          return undefined
        }
        const bytes = Buffer.alloc(Number(held.size) + 1)
        const count = readSync(fd, bytes)
        const after = fstatSync(fd, { bigint: true })
        if (
          count !== Number(held.size) ||
          after.size !== held.size ||
          after.mtimeNs !== held.mtimeNs
        )
          return undefined
        checkCancellation()
        if (!isWithinTime()) return undefined
        bytesRead += count
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count))
        const hash = bytesFingerprint(bytes.subarray(0, count))
        if (hash !== undefined) hashes.set(local, hash)
        cache.set(local, text)
        return text
      } catch {
        checkCancellation()
        return undefined
      } finally {
        if (fd !== undefined) closeSync(fd)
      }
    },
  }
}

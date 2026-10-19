import { fill } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
// Read-only filesystem admission for lane S. No links are followed: each
// file is bound to the exact native identity sampled during enumeration,
// opened read-only, and checked again before any bytes are read. Runtime
// and host lanes can share this adapter rather than supply an unsafe reader.
import { rawBytesFingerprint } from '../verify/fingerprint'
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
  LEGAL_HASH_FILE_MAX_BYTES,
  LEGAL_HASH_TOTAL_MAX_BYTES,
  LEGAL_TOTAL_MAX_BYTES,
} from '../../shared/constants'
import { sameFile } from '../fs/fileIdentity'
import { isCodedError } from '../workspaceRoot'
import {
  assertWorkspaceRelative,
  compareLegalText,
  LegalScanError,
  type LegalFileSnapshot,
} from './files'
import { createYieldCheck } from './scanYield'

/**
 * The pinned SPDX template data shipped beside the scanner (M97
 * CM971-R3): `legal-data/` next to this module, a layout the source tree
 * and `dist/` share.
 */
export const PINNED_LEGAL_DATA_DIRECTORY = path.join(__dirname, 'legal-data')

/**
 * Read one pinned data file's bytes, read-only and without following a
 * final link, bounded like a workspace file. `undefined` when it is
 * missing, a link, oversized or unreadable; the caller fails closed.
 */
export function readPinnedLegalData(
  relativePath: string,
  directory: string = PINNED_LEGAL_DATA_DIRECTORY,
): Uint8Array | undefined {
  const absolute = path.join(directory, ...relativePath.split('/'))
  if (!isWithin(directory, absolute)) return undefined
  let fd: number | undefined
  try {
    if (lstatSync(absolute).isSymbolicLink()) return undefined
    fd = openSync(
      absolute,
      constants.O_RDONLY | (Object.hasOwn(constants, 'O_NOFOLLOW') ? constants.O_NOFOLLOW : 0),
    )
    const held = fstatSync(fd)
    if (!held.isFile() || held.size > LEGAL_FILE_MAX_BYTES) return undefined
    const bytes = Buffer.alloc(held.size)
    return readSync(fd, bytes) === held.size ? bytes : undefined
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const BUILD_META_DIR = 'dist/meta'
const BUILD_HASHES_DIR = 'dist/meta-hashes'
const NODE_MODULES_SEGMENT = 'node_modules/'
/** An installed package's own metadata, licence and notice files. */
const PACKAGE_EVIDENCE_FILE =
  /^(?:package\.json|(?:licen[cs]e|copying|notice|unlicen[cs]e)(?:[.-][\w.-]*)?)$/iu

/** The workspace files a bundle metafile lists: no generated modules, absolute paths or escapes. */
function listedPaths(metafile: unknown): string[] {
  if (typeof metafile !== 'object' || metafile === null) return []
  const keys: string[] = []
  for (const field of ['inputs', 'outputs']) {
    const record: unknown = Reflect.get(metafile, field)
    if (typeof record === 'object' && record !== null) keys.push(...Object.keys(record))
  }
  return keys
    .map((key) => key.replaceAll('\\', '/'))
    .filter(
      (key) =>
        key !== '' &&
        !key.startsWith('/') &&
        !/^[A-Za-z]:\//u.test(key) &&
        !/^\(?[a-z][\w-]*\)?:/iu.test(key) &&
        !key.split('/').includes('..'),
    )
}

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
export async function createLegalSnapshot(
  rootPath: string,
  signal?: AbortSignal,
  // A deadline only when the caller names one: unnamed, the walk runs until
  // it is done or the signal aborts (owner 2026-10-16: no arbitrary limits).
  deadline?: number,
): Promise<LegalWorkspaceSnapshot> {
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
    if (deadline === undefined || Date.now() < deadline) return true
    const message = 'scan stopped at limit: elapsed time'
    if (!incompleteChecks.includes(message)) incompleteChecks.push(message)
    return false
  }
  const checkCancellation = (): void => {
    if (signal?.aborted === true) throw new LegalScanError(UI_TEXT.legalScanner.m111)
  }
  let hashBytesRead = 0
  /**
   * One admitted read of a member's exact bytes: the same identity checks
   * for text and hash reads, each against its own budget.
   */
  const readAdmitted = (
    local: string,
    fileMax: number,
    totalMax: number,
    already: number,
  ): Buffer | undefined => {
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
      if (held.size > BigInt(fileMax) || held.size + BigInt(already) > BigInt(totalMax)) {
        incompleteChecks.push(fill(UI_TEXT.legalScanner.m114, { v0: local }))
        return undefined
      }
      const bytes = Buffer.alloc(Number(held.size) + 1)
      const count = readSync(fd, bytes)
      const after = fstatSync(fd, { bigint: true })
      const isSteady =
        count === Number(held.size) && after.size === held.size && after.mtimeNs === held.mtimeNs
      return isSteady ? bytes.subarray(0, count) : undefined
    } catch {
      checkCancellation()
      return undefined
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  /** Admit one regular, confined file by its workspace path (no budget). */
  const admitFile = (local: string): void => {
    try {
      assertWorkspaceRelative(local)
      const absolute = path.join(root, ...local.split('/'))
      const sample = lstatSync(absolute, { bigint: true })
      if (sample.isFile() && isWithin(root, realpathSync(absolute))) admitted.set(local, sample)
    } catch {
      checkCancellation()
    }
  }
  /** The regular files directly inside a confined, unlinked directory. */
  const filesIn = (local: string): string[] => {
    try {
      const absolute = path.join(root, ...local.split('/'))
      const held = lstatSync(absolute)
      if (held.isSymbolicLink() || !held.isDirectory() || !isWithin(root, realpathSync(absolute)))
        return []
      const dir = opendirSync(absolute)
      const names: string[] = []
      try {
        for (let entry = dir.readSync(); entry !== null; entry = dir.readSync())
          if (entry.isFile()) names.push(entry.name)
      } finally {
        dir.closeSync()
      }
      return names.toSorted((a, b) => compareLegalText(a, b))
    } catch {
      checkCancellation()
      return []
    }
  }
  /**
   * Scan scope (lead ruling 2026-10-10): what the workspace distributes is
   * read first and outside the directory-entry budget. The bundle records
   * (`dist/meta`, `dist/meta-hashes`), every workspace file they list, and
   * the metadata and licence files of each installed package they ship
   * from are admitted before the walk, so they are always reached.
   */
  const admitDistribution = (): void => {
    const records = filesIn(BUILD_META_DIR).filter((name) => name.endsWith('.json'))
    const packages = new Set<string>()
    for (const name of records) {
      admitFile(`${BUILD_META_DIR}/${name}`)
      admitFile(`${BUILD_HASHES_DIR}/${name}`)
      const bytes = readAdmitted(
        `${BUILD_META_DIR}/${name}`,
        LEGAL_HASH_FILE_MAX_BYTES,
        LEGAL_HASH_TOTAL_MAX_BYTES,
        hashBytesRead,
      )
      if (bytes === undefined) continue
      hashBytesRead += bytes.byteLength
      let parsed: unknown
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } catch {
        continue
      }
      for (const entry of listedPaths(parsed)) {
        admitFile(entry)
        const at = entry.lastIndexOf(NODE_MODULES_SEGMENT)
        if (at === -1) continue
        const [scope = '', name2 = ''] = entry.slice(at + NODE_MODULES_SEGMENT.length).split('/', 2)
        packages.add(
          `${entry.slice(0, at + NODE_MODULES_SEGMENT.length)}${scope.startsWith('@') ? `${scope}/${name2}` : scope}`,
        )
      }
    }
    for (const directory of packages)
      for (const name of filesIn(directory))
        if (PACKAGE_EVIDENCE_FILE.test(name)) admitFile(`${directory}/${name}`)
  }
  // Let a Stop/SIGINT abort land mid-walk (PR #214 review): synchronous
  // syscalls block the event loop, so without a yield the abort these
  // checks read could only have arrived before the walk started.
  const checkYield = createYieldCheck(checkCancellation)
  const visit = async (directory: string, localDirectory: string): Promise<void> => {
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
        await checkYield()
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
      // Scan scope (lead ruling 2026-10-10): `.git` holds repository
      // internals and `node_modules` holds installed dependencies; both are
      // expected and skipped, never incomplete reasons. What ships from
      // `node_modules` was admitted first, from the build records.
      if (name === '.git' || name === 'node_modules') continue
      const local = localDirectory === '' ? name : `${localDirectory}/${name}`

      try {
        assertWorkspaceRelative(local)
        const absolute = path.join(directory, name)
        const sample = lstatSync(absolute, { bigint: true })
        if (sample.isSymbolicLink())
          incompleteChecks.push(fill(UI_TEXT.legalScanner.m142, { v0: local }))
        else if (sample.isDirectory()) await visit(absolute, local)
        else if (sample.isFile()) admitted.set(local, sample)
        else incompleteChecks.push(fill(UI_TEXT.legalScanner.m143, { v0: local }))
      } catch (error) {
        if (signal?.aborted === true) throw error
        // A refused path is an incomplete entry; the enumeration moves on.
        if (error instanceof LegalScanError) {
          incompleteChecks.push(fill(UI_TEXT.legalScanner.m144, { v0: local }))
          continue
        }
        // A shaped store failure is an incomplete entry; anything else keeps
        // its kind past the enumeration.
        if (isCodedError(error)) {
          incompleteChecks.push(fill(UI_TEXT.legalScanner.m144, { v0: local }))
          continue
        }
        throw error
      }
      await checkYield()
    }
  }
  admitDistribution()
  await visit(root, '')
  return {
    files: Array.from(admitted.keys(), (entry) => entry).toSorted((a, b) => compareLegalText(a, b)),
    incompleteChecks,
    // The SHA-256 of a member's exact bytes, text or binary (M97
    // CM971-R3): freshness compares these with the build's own record. A
    // hash read keeps no bytes, so it has its own, larger budget.
    readFileHash: (local) => {
      checkCancellation()
      assertWorkspaceRelative(local)
      const known = hashes.get(local)
      if (known !== undefined || !isWithinTime()) return known
      const bytes = readAdmitted(
        local,
        LEGAL_HASH_FILE_MAX_BYTES,
        LEGAL_HASH_TOTAL_MAX_BYTES,
        hashBytesRead,
      )
      if (bytes === undefined) return
      hashBytesRead += bytes.byteLength
      const hash = rawBytesFingerprint(bytes)
      hashes.set(local, hash)
      return hash
    },
    readFile: (local: string): string | undefined => {
      checkCancellation()
      assertWorkspaceRelative(local)
      if (!isWithinTime()) return undefined
      if (cache.has(local)) return cache.get(local)
      const bytes = readAdmitted(local, LEGAL_FILE_MAX_BYTES, LEGAL_TOTAL_MAX_BYTES, bytesRead)
      checkCancellation()
      if (bytes === undefined || !isWithinTime()) return undefined
      bytesRead += bytes.byteLength
      hashes.set(local, rawBytesFingerprint(bytes))
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        cache.set(local, text)
        return text
      } catch (error: unknown) {
        checkCancellation()
        // Undecodable bytes read absent.
        if (error instanceof TypeError) {
          return undefined
        }
        // A shaped store failure reads absent; anything else keeps its kind
        // past the read.
        if (isCodedError(error)) {
          return undefined
        }
        throw error
      }
    },
  }
}

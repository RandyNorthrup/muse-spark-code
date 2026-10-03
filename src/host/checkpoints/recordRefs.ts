// The checkpoint store's records as git refs (M72, M86; PLAN.md D51, D63).
// Each record is a tree in the shadow repository holding its JSON
// (`record.json`) and every copy it needs, under a ref of its own. Git
// updates a ref atomically and only from the value it was read at
// (`update-ref <ref> <new> <old>`), so two windows on the same folder never
// overwrite each other's records and never need a lock: a record is created
// only if absent, changed only from what was read, and deleted only if
// unchanged.
//
// - M86 units: `refs/muse-spark/m86/unit/<conversation key>/<number>`. The
//   ref's name is the unit's number in its conversation: creating it only if
//   absent is how a number is taken (a second window asking for the same
//   number finds it taken and takes the next).
// - M72 records, read only (and deleted by cleanup): `refs/muse-spark/record/<id>`.

import { createHash } from 'node:crypto'
import { type BlobRef, parseCatFileEntries } from '../../core/checkpoints/gitListings'
import { CHECKPOINT_RECORD_READ_BATCH, GIT_SHA1_HEX_LENGTH } from '../../shared/constants'
import { isGitExitError } from '../git'
import { parseRecord, parseUnit, type StoredRecord, type StoredUnit } from './checkpointRecords'
import type { ShadowGit } from './shadowGit'

export const RECORD_REF_PREFIX = 'refs/muse-spark/record/'
export const UNIT_REF_PREFIX = 'refs/muse-spark/m86/unit/'
const RECORD_FILE = 'record.json'
const FILE_MODE = '100644'
const SEPARATOR = '/'
// The name an absent ref has in a compare-and-swap: create only if absent.
// SHA-1 (the shadow repository's object format is checked when it is set up).
const ABSENT = '0'.repeat(GIT_SHA1_HEX_LENGTH)
const NUL = '\0'
const LINE_FEED = '\n'
const SPACE = ' '
const DECIMAL = /^\d+$/u

/** An M72 record as listed: its id, the tree its ref names, and the record (undefined: unreadable). */
export interface ListedRecord {
  readonly id: string
  readonly keep: string
  readonly record: StoredRecord | undefined
}

/**
 * A unit as listed: its ref, the tree the ref names, its conversation's key
 * and number from the ref's name, and the record (undefined: unreadable, or
 * not the record its name says).
 */
export interface ListedUnit {
  readonly ref: string
  readonly keep: string
  readonly sessionKey: string
  readonly sequence: number
  readonly record: StoredUnit | undefined
}

/** A ref to delete, only while it still names the tree it was read at. */
export interface HeldRef {
  readonly ref: string
  readonly keep: string
}

/** The key of a conversation in a ref name: any session id makes a valid one. */
export function sessionKey(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex')
}

export function unitRef(sessionId: string, sequence: number): string {
  return `${UNIT_REF_PREFIX}${sessionKey(sessionId)}${SEPARATOR}${String(sequence)}`
}

export function recordRef(id: string): string {
  return `${RECORD_REF_PREFIX}${id}`
}

/** The object a ref currently names; undefined when absent. */
export async function refValue(
  shadow: ShadowGit,
  ref: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const value = await shadow.text(['for-each-ref', '--format=%(objectname)', ref], {
    ...(signal !== undefined && { signal }),
  })
  return value === '' ? undefined : value
}

/** A CAS conflict differs from IO failure or a reply lost after persistence. */
export async function didWriteRef(
  shadow: ShadowGit,
  ref: string,
  next: string,
  previous: string | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await shadow.run(['update-ref', ref, next, previous ?? ABSENT], {
      ...(signal !== undefined && { signal }),
    })
    return true
  } catch (error: unknown) {
    if (isGitExitError(error)) {
      const current = await refValue(shadow, ref, signal)
      if (current === next) {
        return true
      }
      if (current !== previous) {
        return false
      }
    }
    throw error
  }
}

function nulInput(values: readonly string[]): string {
  return values.map((value) => `${value}${NUL}`).join('')
}

/** The refs under a prefix with the object each names, as they stand now. */
async function listRefs(
  shadow: ShadowGit,
  prefix: string,
): Promise<readonly { readonly ref: string; readonly keep: string }[]> {
  const listing = await shadow.text(['for-each-ref', '--format=%(objectname) %(refname)', prefix])
  return listing
    .split(LINE_FEED)
    .filter((line) => line !== '')
    .map((line) => {
      const [keep = '', ref = ''] = line.split(SPACE)
      return { keep, ref }
    })
}

/** Each tree's `record.json` text, in order; undefined where it has none. */
async function recordTexts(
  shadow: ShadowGit,
  keeps: readonly string[],
  signal?: AbortSignal,
): Promise<readonly (string | undefined)[]> {
  const texts: (string | undefined)[] = []
  for (let start = 0; start < keeps.length; start += CHECKPOINT_RECORD_READ_BATCH) {
    const batch = keeps.slice(start, start + CHECKPOINT_RECORD_READ_BATCH)
    const output = await shadow.run(['cat-file', '--batch'], {
      input: batch.map((keep) => `${keep}:${RECORD_FILE}${LINE_FEED}`).join(''),
      ...(signal !== undefined && { signal }),
    })
    const entries = parseCatFileEntries(output)
    for (const index of batch.keys()) {
      texts.push(entries[index]?.content?.toString('utf8'))
    }
  }
  return texts
}

/** Every M72 record the shadow repository holds, read as it stands now. */
export async function listRecords(shadow: ShadowGit): Promise<readonly ListedRecord[]> {
  const refs = await listRefs(shadow, RECORD_REF_PREFIX)
  const texts = await recordTexts(
    shadow,
    refs.map((entry) => entry.keep),
  )
  return refs.map((entry, index) => {
    const id = entry.ref.slice(RECORD_REF_PREFIX.length)
    const text = texts[index]
    const record = text === undefined ? undefined : parseRecord(text)
    return { id, keep: entry.keep, record: record?.id === id ? record : undefined }
  })
}

/**
 * Every unit the shadow repository holds, read as it stands now. A ref whose
 * name is no unit's is left out; one whose record does not parse, or is not
 * the unit its name says, is listed with no record.
 */
export async function listUnits(shadow: ShadowGit): Promise<readonly ListedUnit[]> {
  const refs = await listRefs(shadow, UNIT_REF_PREFIX)
  const named = refs.flatMap((entry) => {
    const [key = '', number = '', ...rest] = entry.ref
      .slice(UNIT_REF_PREFIX.length)
      .split(SEPARATOR)
    return rest.length === 0 && DECIMAL.test(number)
      ? [{ ...entry, sessionKey: key, sequence: Number(number) }]
      : []
  })
  const texts = await recordTexts(
    shadow,
    named.map((entry) => entry.keep),
  )
  return named.map((entry, index) => {
    const text = texts[index]
    const record = text === undefined ? undefined : parseUnit(text)
    const isNamed =
      record?.sequence === entry.sequence && sessionKey(record.owner.sessionId) === entry.sessionKey
    return { ...entry, record: isNamed ? record : undefined }
  })
}

/** One tree holding the record's JSON (when given) and blobs, so one ref keeps them all. */
export async function keepTree(
  shadow: ShadowGit,
  json: string | undefined,
  blobs: readonly BlobRef[],
  signal?: AbortSignal,
): Promise<string> {
  const lines = blobs.map((blob, index) => `${blob.mode} blob ${blob.oid}\tb${String(index)}`)
  if (json !== undefined) {
    const oid = await shadow.text(['hash-object', '-w', '--stdin'], {
      input: json,
      ...(signal !== undefined && { signal }),
    })
    lines.push(`${FILE_MODE} blob ${oid}\t${RECORD_FILE}`)
  }
  return await shadow.text(['mktree', '-z'], {
    input: nulInput(lines),
    ...(signal !== undefined && { signal }),
  })
}

/**
 * Writes a unit record at its ref: created only if absent (`previous`
 * undefined), or changed only from the tree it was read at. The new tree, or
 * undefined when the ref was not what was expected (another window took the
 * number, or changed the record).
 */
export async function writeUnit(
  shadow: ShadowGit,
  ref: string,
  record: StoredUnit,
  blobs: readonly BlobRef[],
  previous: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const keep = await keepTree(shadow, JSON.stringify(record), blobs, signal)
  return (await didWriteRef(shadow, ref, keep, previous, signal)) ? keep : undefined
}

/** The record a unit's ref names now, with the tree; undefined when the ref is gone or unreadable. */
export async function readUnit(
  shadow: ShadowGit,
  ref: string,
  signal?: AbortSignal,
): Promise<{ readonly keep: string; readonly record: StoredUnit } | undefined> {
  const keep = await refValue(shadow, ref, signal)
  if (keep === undefined) {
    return undefined
  }
  const [text] = await recordTexts(shadow, [keep], signal)
  const record = text === undefined ? undefined : parseUnit(text)
  return record === undefined ? undefined : { keep, record }
}

/**
 * Deletes refs, each only if it still names the tree it was read at: all at
 * once when none changed, else one by one, leaving any that did. The refs
 * deleted.
 */
export async function deleteRefs(
  shadow: ShadowGit,
  refs: readonly HeldRef[],
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (refs.length === 0) {
    return []
  }
  const line = (entry: HeldRef) => `delete ${entry.ref} ${entry.keep}${LINE_FEED}`
  try {
    await shadow.run(['update-ref', '--stdin'], {
      input: refs.map((entry) => line(entry)).join(''),
      ...(signal !== undefined && { signal }),
    })
    return refs.map((entry) => entry.ref)
  } catch (error: unknown) {
    if (!isGitExitError(error)) {
      throw error
    }
  }
  const deleted: string[] = []
  for (const entry of refs) {
    try {
      await shadow.run(['update-ref', '--stdin'], {
        input: line(entry),
        ...(signal !== undefined && { signal }),
      })
      deleted.push(entry.ref)
    } catch (error: unknown) {
      if (!isGitExitError(error) || (await refValue(shadow, entry.ref, signal)) === entry.keep) {
        throw error
      }
    }
  }
  return deleted
}

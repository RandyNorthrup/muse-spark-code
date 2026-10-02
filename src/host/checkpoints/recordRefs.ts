// The checkpoint store's records as git refs (M72, PLAN.md D51). Each
// record is a tree in the shadow repository holding its JSON
// (`record.json`) and every tree and copy it needs, under a ref of its own,
// `refs/muse-spark/record/<id>`. Git updates a ref atomically and only from
// the value it was read at (`update-ref <ref> <new> <old>`), so two windows
// on the same folder never overwrite each other's records and never need a
// lock: a record is created only if absent, changed only from what was
// read, and deleted only if unchanged.

import { type BlobRef, parseCatFileEntries } from '../../core/checkpoints/gitListings'
import { CHECKPOINT_RECORD_READ_BATCH, GIT_SHA1_HEX_LENGTH } from '../../shared/constants'
import { isGitExitError } from '../git'
import { parseRecord, type StoredRecord } from './checkpointRecords'
import type { ShadowGit } from './shadowGit'

export const RECORD_REF_PREFIX = 'refs/muse-spark/record/'
const RECORD_FILE = 'record.json'
const TREE_MODE = '040000'
const FILE_MODE = '100644'
// The name an absent ref has in a compare-and-swap: create only if absent.
// SHA-1 (the shadow repository's object format is checked when it is set up).
const ABSENT = '0'.repeat(GIT_SHA1_HEX_LENGTH)
// Records read per `cat-file` (its output is capped at GIT_OUTPUT_MAX_BYTES).
const NUL = '\0'
const LINE_FEED = '\n'
const SPACE = ' '

/** A record as listed: its id, the tree its ref names, and the record (undefined: unreadable). */
export interface ListedRecord {
  readonly id: string
  readonly keep: string
  readonly record: StoredRecord | undefined
}

/** What a record's tree keeps from pruning besides its JSON. */
export interface KeptObjects {
  readonly trees: readonly { readonly name: string; readonly tree: string }[]
  readonly blobs: readonly BlobRef[]
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

/** Every record the shadow repository holds, read as it stands now. */
export async function listRecords(shadow: ShadowGit): Promise<readonly ListedRecord[]> {
  const listing = await shadow.text([
    'for-each-ref',
    '--format=%(objectname) %(refname)',
    RECORD_REF_PREFIX,
  ])
  const refs = listing
    .split(LINE_FEED)
    .filter((line) => line !== '')
    .map((line) => {
      const [keep = '', ref = ''] = line.split(SPACE)
      return { keep, id: ref.slice(RECORD_REF_PREFIX.length) }
    })
  const listed: ListedRecord[] = []
  for (let start = 0; start < refs.length; start += CHECKPOINT_RECORD_READ_BATCH) {
    const batch = refs.slice(start, start + CHECKPOINT_RECORD_READ_BATCH)
    const output = await shadow.run(['cat-file', '--batch'], {
      input: batch.map((ref) => `${ref.keep}:${RECORD_FILE}${LINE_FEED}`).join(''),
    })
    const entries = parseCatFileEntries(output)
    for (const [index, ref] of batch.entries()) {
      const content = entries[index]?.content
      const record = content === undefined ? undefined : parseRecord(content.toString('utf8'))
      listed.push({ ...ref, record: record?.id === ref.id ? record : undefined })
    }
  }
  return listed
}

/** One tree holding the record's JSON (when given), trees and blobs, so one ref keeps them all. */
export async function keepTree(
  shadow: ShadowGit,
  record: StoredRecord | undefined,
  kept: KeptObjects,
  signal?: AbortSignal,
): Promise<string> {
  const lines = [
    ...kept.trees.map((entry) => `${TREE_MODE} tree ${entry.tree}\t${entry.name}`),
    ...kept.blobs.map((blob, index) => `${blob.mode} blob ${blob.oid}\tb${String(index)}`),
  ]
  if (record !== undefined) {
    const json = await shadow.text(['hash-object', '-w', '--stdin'], {
      input: JSON.stringify(record),
      ...(signal !== undefined && { signal }),
    })
    lines.push(`${FILE_MODE} blob ${json}\t${RECORD_FILE}`)
  }
  return await shadow.text(['mktree', '-z'], {
    input: nulInput(lines),
    ...(signal !== undefined && { signal }),
  })
}

/**
 * Writes a record: created only if absent (`previous` undefined), or
 * changed only from the tree it was read at. The new tree, or undefined
 * when the ref was not what was expected (another window changed it).
 */
export async function writeRecord(
  shadow: ShadowGit,
  record: StoredRecord,
  kept: KeptObjects,
  previous: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const keep = await keepTree(shadow, record, kept, signal)
  return (await didWriteRef(shadow, recordRef(record.id), keep, previous, signal))
    ? keep
    : undefined
}

/**
 * Deletes records, each only if its ref still names the tree it was read
 * at: all at once when none changed, else one by one, leaving any that did.
 * The ids deleted.
 */
export async function deleteRecords(
  shadow: ShadowGit,
  records: readonly Pick<ListedRecord, 'id' | 'keep'>[],
  signal?: AbortSignal,
): Promise<readonly string[]> {
  if (records.length === 0) {
    return []
  }
  const line = (entry: Pick<ListedRecord, 'id' | 'keep'>) =>
    `delete ${recordRef(entry.id)} ${entry.keep}${LINE_FEED}`
  try {
    await shadow.run(['update-ref', '--stdin'], {
      input: records.map((entry) => line(entry)).join(''),
      ...(signal !== undefined && { signal }),
    })
    return records.map((entry) => entry.id)
  } catch (error: unknown) {
    if (!isGitExitError(error)) {
      throw error
    }
  }
  const deleted: string[] = []
  for (const entry of records) {
    try {
      await shadow.run(['update-ref', '--stdin'], {
        input: line(entry),
        ...(signal !== undefined && { signal }),
      })
      deleted.push(entry.id)
    } catch (error: unknown) {
      if (
        !isGitExitError(error) ||
        (await refValue(shadow, recordRef(entry.id), signal)) === entry.keep
      ) {
        throw error
      }
    }
  }
  return deleted
}

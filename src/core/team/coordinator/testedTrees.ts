// M96d tested-tree cache (PLAN.md D75): a merged tree already tested
// reuses its result only when the snapshot's tree hash and the check
// identity are both equal — M96c's admission key. The cache is owned
// by the machine coordinator so every window shares it; a lookup hit
// skips the checks, a miss runs them. Only terminal outcomes are
// recorded: a pass, or a failure that already survived the queue's
// flake retries. Nothing uncertain is ever recorded, so a lost or
// unreadable cache file only costs retests — unlike the grant
// ledger, an empty cache here is the safe direction, never a block.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { writeFileAtomic } from '../../fs/atomicFile'
import {
  COORDINATOR_STORE_VERSION,
  COORDINATOR_TESTED_TREE_CACHE_MAX,
  COORDINATOR_TESTED_TREE_FILE_MAX_BYTES,
} from '../../../shared/constants'

const TESTED_TREES_FILE = 'tested-trees.json'

/** A terminal check outcome: a pass, or a post-retry failure. There is no third case. */
export type TestedTreeOutcome =
  | { readonly status: 'passed'; readonly flaky: readonly string[] }
  | { readonly status: 'failed'; readonly failures: readonly TestedTreeFailure[] }

export interface TestedTreeFailure {
  readonly id: string
  readonly output: string
}

export interface TestedTreeRecord {
  readonly tree: string
  readonly checkIdentity: string
  readonly outcome: TestedTreeOutcome
  readonly checkRuns: number
  readonly recordedAt: number
}

const testedTreeFailureSchema = z.strictObject({
  id: z.string().check(z.minLength(1)),
  output: z.string(),
})

const testedTreeOutcomeSchema = z.union([
  z.strictObject({ status: z.literal('passed'), flaky: z.array(z.string()) }),
  z.strictObject({ status: z.literal('failed'), failures: z.array(testedTreeFailureSchema) }),
])

const testedTreeRecordSchema = z.strictObject({
  tree: z.string().check(z.minLength(1)),
  checkIdentity: z.string().check(z.minLength(1)),
  outcome: testedTreeOutcomeSchema,
  checkRuns: z.number().check(z.int(), z.gte(0)),
  recordedAt: z.number().check(z.int(), z.gte(0)),
})

const testedTreesFileSchema = z.strictObject({
  version: z.literal(COORDINATOR_STORE_VERSION),
  records: z.array(testedTreeRecordSchema),
})

/** An unambiguous join: exact equality on both halves, or no hit. */
function cacheKey(tree: string, checkIdentity: string): string {
  return JSON.stringify([tree, checkIdentity])
}

/**
The machine-wide tested-tree cache: an LRU over exact
(tree hash, check identity) pairs. Hits refresh recency; records
beyond the cap evict least-recently-used first.
*/
export class TestedTreeCache {
  private readonly records = new Map<string, TestedTreeRecord>()

  public constructor(records: readonly TestedTreeRecord[] = []) {
    for (const record of records)
      this.records.set(cacheKey(record.tree, record.checkIdentity), record)
  }

  public get size(): number {
    return this.records.size
  }

  public entries(): readonly TestedTreeRecord[] {
    return Array.from(this.records.values(), (record) => record)
  }

  /** A hit refreshes recency. An empty key never hits: it always retests. */
  public lookup(tree: string, checkIdentity: string): TestedTreeOutcome | undefined {
    if (tree.length === 0 || checkIdentity.length === 0) return undefined
    const record = this.records.get(cacheKey(tree, checkIdentity))
    if (record === undefined) return undefined
    this.records.delete(cacheKey(tree, checkIdentity))
    this.records.set(cacheKey(tree, checkIdentity), record)
    return record.outcome
  }

  /** Records a terminal outcome; an empty key is a harness bug and throws. */
  public record(
    tree: string,
    checkIdentity: string,
    outcome: TestedTreeOutcome,
    checkRuns: number,
    recordedAt: number = Date.now(),
  ): void {
    if (tree.length === 0 || checkIdentity.length === 0) throw new Error('tested-tree key is empty')
    const key = cacheKey(tree, checkIdentity)
    this.records.delete(key)
    this.records.set(key, { tree, checkIdentity, outcome, checkRuns, recordedAt })
    for (const oldest of this.records.keys()) {
      if (this.records.size <= COORDINATOR_TESTED_TREE_CACHE_MAX) break
      this.records.delete(oldest)
    }
  }
}

/** A file that is simply not there: absent, never a failure. */
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** A missing, oversized or malformed cache file is an empty cache: retest. */
export async function loadTestedTrees(storeDirectory: string): Promise<TestedTreeCache> {
  let text: string
  try {
    text = await readFile(path.join(storeDirectory, TESTED_TREES_FILE), 'utf8')
  } catch (error: unknown) {
    // NARROW: only absence means an empty cache; any other I/O error is real.
    if (isMissingFile(error)) return new TestedTreeCache()
    throw error
  }
  if (text.length > COORDINATOR_TESTED_TREE_FILE_MAX_BYTES) return new TestedTreeCache()
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error: unknown) {
    // NARROW: malformed bytes are an empty cache; anything else is real.
    if (error instanceof SyntaxError) return new TestedTreeCache()
    throw error
  }
  const file = testedTreesFileSchema.safeParse(parsed)
  return file.success
    ? new TestedTreeCache(file.data.records.slice(-COORDINATOR_TESTED_TREE_CACHE_MAX))
    : new TestedTreeCache()
}

/**
Persists the cache beside the ledger through the one atomic
writer. Oldest records drop first when the bytes would overflow.
*/
export async function saveTestedTrees(
  storeDirectory: string,
  cache: TestedTreeCache,
): Promise<void> {
  const records = Array.from(cache.entries(), (record) => record)
  while (records.length > 0) {
    const text = JSON.stringify({
      version: COORDINATOR_STORE_VERSION,
      records: records.slice(-COORDINATOR_TESTED_TREE_CACHE_MAX),
    })
    if (text.length <= COORDINATOR_TESTED_TREE_FILE_MAX_BYTES) {
      await writeFileAtomic(storeDirectory, TESTED_TREES_FILE, text)
      return
    }
    records.shift()
  }
  await writeFileAtomic(
    storeDirectory,
    TESTED_TREES_FILE,
    JSON.stringify({ version: COORDINATOR_STORE_VERSION, records: [] }),
  )
}

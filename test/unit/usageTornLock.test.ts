// The usage journal's lock over a torn claim, on real files with the real
// NodeUsageFs. Windows real use, 0.19.0: this PC's newest resource-history
// claim held 36 NUL bytes (the writer died after the length reached the disk
// and before its token did), every later acquisition threw invalidUsageLock,
// and usage history stopped on 16 October.
import { readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { USAGE_JOURNAL_ROOT } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { USAGE_ROLLUP_LOCK, USAGE_ROLLUP_LOCK_STALE_MS } from '../../src/shared/constants'

const LOCK = `${USAGE_JOURNAL_ROOT}/${USAGE_ROLLUP_LOCK}`
const state = { dir: '' }

beforeEach(async () => {
  state.dir = await mkdtemp(path.join(tmpdir(), 'muse-usage-torn-'))
})
afterEach(async () => {
  await rm(state.dir, { recursive: true, force: true })
})

/** A first real claim, then its file torn the way this PC's was: NUL bytes only. */
async function tornClaim(content: string): Promise<string> {
  const store = new NodeUsageFs(state.dir)
  const first = await store.acquireLock(LOCK, USAGE_ROLLUP_LOCK_STALE_MS)
  if (first === undefined) throw new Error('the first claim was not taken')
  const lockFile = path.join(state.dir, ...LOCK.split('/'))
  const epoch = readFileSync(`${lockFile}.epoch`, 'utf8').trim()
  const claim = `${lockFile}.${epoch}.${String(first.generation)}`
  writeFileSync(claim, content)
  return claim
}

function age(file: string): void {
  const past = new Date(Date.now() - USAGE_ROLLUP_LOCK_STALE_MS - 60_000)
  utimesSync(file, past, past)
}

it('a stale claim holding only NUL bytes is taken over, never refused for good', async () => {
  const claim = await tornClaim('\0'.repeat(36))
  // Still fresh: an unwritten claim may belong to a writer at work.
  await expect(
    new NodeUsageFs(state.dir).acquireLock(LOCK, USAGE_ROLLUP_LOCK_STALE_MS),
  ).resolves.toBeUndefined()
  age(claim)
  const next = await new NodeUsageFs(state.dir).acquireLock(LOCK, USAGE_ROLLUP_LOCK_STALE_MS)
  expect(next?.generation).toBe(2)
  await next?.release()
})

it('a claim holding anything else that is not a token is still refused', async () => {
  const claim = await tornClaim('not a token!')
  age(claim)
  await expect(
    new NodeUsageFs(state.dir).acquireLock(LOCK, USAGE_ROLLUP_LOCK_STALE_MS),
  ).rejects.toThrow('invalidUsageLock')
})

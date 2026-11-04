// A refused landing's words, the one source the card, Traffic and an ACP session read
// (CC-WINLAND §5 item 6). Every holder here is one the real git probes returned over a
// real folder, never written by hand: what the person reads must never show its shape.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { mergeRefusalForLog, mergeRefusalSentence } from '../../src/core/team/teamMergeRefusalWords'
import {
  indexLockHolder,
  knownRepositoryHolder,
  takeIndexLock,
} from '../../src/host/team/gitIndexLock'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { collectingLogger } from './helpers/collectingLogger'
import { installGerman, restoreEnglish } from './helpers/kindGermanTable'

const REF = 'refs/heads/agents/landing/one'
const BRANCH = 'agents/landing/one'

function gitFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-refusal-words-'))
  onTestFinished(() => {
    rmSync(folder, { force: true, recursive: true })
  })
  return folder
}

/** A bare lock: git's own, or a stranger's, with nothing of ours in it. */
async function bareLock(folder: string) {
  const lock = path.join(folder, 'index.lock')
  writeFileSync(lock, '')
  const holder = await indexLockHolder(folder)
  if (holder === undefined) throw new Error('the lock is there')
  return { lock, holder }
}

afterEach(() => {
  restoreEnglish()
})

describe('a refused landing in the person’s words', () => {
  it('tells the person to remove a bare lock themselves, and never shows the holder', async () => {
    const { lock, holder } = await bareLock(gitFolder())
    const held = fill(UI_TEXT.teamTrafficNotices.heldByLock, { path: lock })
    expect(mergeRefusalSentence({ kind: 'busy', action: 'recheck', holder })).toBe(
      `${held} ${UI_TEXT.teamTrafficNotices.landingBusyThen}`,
    )
    const branched = mergeRefusalSentence({ kind: 'branched', holder, branch: REF })
    expect(branched).toBe(
      `${held} ${fill(UI_TEXT.teamTrafficNotices.landingBranchedThen, { branch: BRANCH })}`,
    )
    expect(branched).not.toContain('owner')
    expect(branched).not.toContain('"')
  })

  it('names another landing as the lock’s holder when its record says so', async () => {
    const folder = gitFolder()
    const taken = await takeIndexLock(folder, { landingId: 'landing-1', windowInstanceId: 'w-1' })
    if (taken.kind !== 'taken') throw new Error('the lock was free')
    const holder = await indexLockHolder(folder)
    expect(mergeRefusalSentence({ kind: 'busy', action: 'recheck', holder })).toBe(
      `${fill(UI_TEXT.teamTrafficNotices.heldByLanding, { path: taken.lease.path })} ${
        UI_TEXT.teamTrafficNotices.landingBusyThen
      }`,
    )
    await taken.lease.release()
  })

  it('names a git operation in progress, and another window', async () => {
    const folder = gitFolder()
    writeFileSync(path.join(folder, 'MERGE_HEAD'), '')
    const operation = await knownRepositoryHolder(folder, folder, 'this-window', [])
    expect(mergeRefusalSentence({ kind: 'busy', holder: operation })).toBe(
      `${fill(UI_TEXT.teamTrafficNotices.heldByOperation, {
        path: path.join(folder, 'MERGE_HEAD'),
      })} ${UI_TEXT.teamTrafficNotices.landingBusyThen}`,
    )
    const other = await knownRepositoryHolder(folder, folder, 'this-window', [
      { workingTree: folder, windowInstanceId: 'another-window', fresh: true },
    ])
    expect(mergeRefusalSentence({ kind: 'branched', holder: other, branch: REF })).toBe(
      `${UI_TEXT.teamTrafficNotices.heldByWindow} ${fill(
        UI_TEXT.teamTrafficNotices.landingBranchedThen,
        { branch: BRANCH },
      )}`,
    )
  })

  it('says what to do when nothing holds the repository', () => {
    const notices = UI_TEXT.teamTrafficNotices
    expect(mergeRefusalSentence({ kind: 'busy', action: 'recheck' })).toBe(notices.landingBusyOpen)
    expect(mergeRefusalSentence({ kind: 'stale', action: 'rebuild' })).toBe(notices.landingStale)
    expect(mergeRefusalSentence({ kind: 'denied' })).toBe(notices.landingDenied)
    expect(mergeRefusalSentence({ kind: 'branched', branch: REF })).toBe(
      fill(notices.landingBranchedThen, { branch: BRANCH }),
    )
  })

  it('reads the installed language, never English baked in', async () => {
    const { lock, holder } = await bareLock(gitFolder())
    await installGerman(collectingLogger([]))
    const german = mergeRefusalSentence({ kind: 'branched', holder, branch: REF })
    expect(german).toContain(lock)
    expect(german).toContain(
      fill(UI_TEXT.teamTrafficNotices.landingBranchedThen, { branch: BRANCH }),
    )
    expect(german).toContain('Muse Spark Code')
    expect(german).not.toContain('Nothing landed')
    expect(mergeRefusalSentence({ kind: 'denied' })).not.toContain('not approved')
  })

  it('keeps the technical detail for the log, and no path', async () => {
    const folder = gitFolder()
    const taken = await takeIndexLock(folder, { landingId: 'landing-1', windowInstanceId: 'w-1' })
    if (taken.kind !== 'taken') throw new Error('the lock was free')
    const line = mergeRefusalForLog({
      kind: 'branched',
      holder: await indexLockHolder(folder),
      branch: REF,
    })
    expect(line).toBe(`branched, holder lock, landing landing-1, window w-1, branch ${REF}`)
    expect(line).not.toContain(folder)
    await taken.lease.release()
    const bare = await bareLock(gitFolder())
    expect(mergeRefusalForLog({ kind: 'busy', holder: bare.holder })).toBe('busy, holder lock')
  })
})

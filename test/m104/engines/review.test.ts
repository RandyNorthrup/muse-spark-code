import { engineFixtures } from './fixtures'
import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { createRuntimeReview } from '../../../src/runtime/features/review'
import { UI_TEXT, REVIEW_MARKER_BYTES } from '../../../src/shared/constants'
import { aliasedReviewRepositories } from '../../unit/helpers/reviewRoots'

const fixtures = engineFixtures()
const git = (args: readonly string[], cwd: string) =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' })

async function setup() {
  const base = await fixtures.folder('m104-pb-review-')
  const repositories = await aliasedReviewRepositories(base, 'review')
  const state = { isTrusted: true, isAvailable: true, isCurrent: true }
  const runGit = vi.fn(
    (args: readonly string[], cwd: string, _timeout: number | undefined, _signal: AbortSignal) =>
      Promise.resolve(git(args, cwd)),
  )
  const owner = createRuntimeReview(
    {
      workspaceRoot: repositories.alias,
      runGit,
      pickOne: () => Promise.resolve(undefined),
      isTrusted: () => state.isTrusted,
      isAvailable: () => state.isAvailable,
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('replaced')
      },
    },
    UI_TEXT,
    'en',
  )
  fixtures.own(owner)
  return { owner, state, runGit, repositories, git }
}
const request = { scope: 'uncommitted', focus: 'general' } as const
function hold(owner: ReturnType<typeof createRuntimeReview>) {
  const restored = vi.fn()
  const held = owner.review.createHold({
    planMode: 'denyUnmatched',
    restoreMode: () => 'promptUnmatched',
    onRestored: restored,
  })
  const session = {
    setApprovalMode: vi.fn(() => Promise.resolve()),
    sendTurn: vi.fn(() => Promise.resolve({ turnId: 'turn', disposition: 'started' as const })),
  }
  return { held, session, restored }
}
describe('portable review material and Plan lifetime', () => {
  it('reads real guarded Git material and builds the existing untrusted review prompt', async () => {
    const { owner, runGit } = await setup()
    const result = await owner.review.collect(request, () => true)
    expect(result.kind).toBe('material')
    if (result.kind !== 'material') throw new Error('fixture has no material')
    expect(result.material.diff).toContain('OWNED_A_EDIT_NEXT')
    expect(result.material.diff).not.toContain('OWNED_B_EDIT')
    expect(result.isCurrent()).toBe(true)
    const marker = owner.review.newMarker()
    expect(marker).toHaveLength(REVIEW_MARKER_BYTES * 2)
    expect(
      owner.review.turnText({
        request,
        material: result.material,
        newMarker: () => marker,
        isRoleIncluded: false,
      }),
    ).toContain(marker)
    expect(runGit.mock.calls.every((call) => call[1] !== '')).toBe(true)
  })
  it.each(['isTrusted', 'isAvailable', 'isCurrent'] as const)(
    'refuses inactive %s without Git or a new hold',
    async (field) => {
      const { owner, state, runGit } = await setup()
      state[field] = false
      expect(await owner.review.collect(request, () => true)).toEqual({ kind: 'cancelled' })
      expect(runGit).not.toHaveBeenCalled()
      expect(() => hold(owner)).toThrow(UI_TEXT.reviewCancelled)
    },
  )
  it('withdraws material ownership after an alias retarget or selected-profile replacement', async () => {
    const { owner, repositories, state } = await setup()
    const result = await owner.review.collect(request, () => true)
    expect(result.kind).toBe('material')
    if (result.kind !== 'material') throw new Error('fixture has no material')
    state.isCurrent = false
    expect(result.isCurrent()).toBe(false)
    state.isCurrent = true
    repositories.retarget()
    expect(result.isCurrent()).toBe(false)
  })
  it('stops collecting immediately after live trust is revoked during Git', async () => {
    const { owner, runGit, git, state } = await setup()
    runGit.mockImplementationOnce((args, cwd) => {
      const output = git(args, cwd)
      state.isTrusted = false
      return Promise.resolve(output)
    })
    expect(await owner.review.collect(request, () => true)).toEqual({ kind: 'cancelled' })
    expect(runGit).toHaveBeenCalledOnce()
  })
  it('cancels and drains a held Git call and publishes no late material', async () => {
    const { owner, runGit } = await setup()
    const pending = Promise.withResolvers<string>()
    runGit.mockReturnValueOnce(pending.promise)
    const collecting = owner.review.collect(request, () => true)
    await vi.waitFor(() => {
      expect(runGit).toHaveBeenCalledOnce()
    })
    let isClosed = false
    const closing = (async () => {
      await owner.dispose()
      isClosed = true
    })()
    expect(runGit.mock.calls[0]?.[3].aborted).toBe(true)
    expect(isClosed).toBe(false)
    pending.resolve('')
    expect(await collecting).toEqual({ kind: 'cancelled' })
    await closing
    expect(isClosed).toBe(true)
  })
  it('never mutates a mode on a released hold or a replaced owner', async () => {
    const { owner, state } = await setup()
    const first = hold(owner)
    state.isCurrent = false
    await expect(first.held.send(first.session, [], '/review', () => true)).rejects.toThrow()
    expect(first.session.setApprovalMode).not.toHaveBeenCalled()
    state.isCurrent = true
    const second = hold(owner)
    await owner.dispose()
    await expect(second.held.send(second.session, [], '/review', () => true)).rejects.toThrow()
    expect(second.session.setApprovalMode).not.toHaveBeenCalled()
    expect(second.session.sendTurn).not.toHaveBeenCalled()
  })
  it('waits for an admitted mode change during release and never sends the turn', async () => {
    const { owner } = await setup()
    const { held, session } = hold(owner)
    const pending = Promise.withResolvers<undefined>()
    session.setApprovalMode.mockReturnValueOnce(pending.promise)
    const sending = held.send(session, [], '/review', () => true)
    const closing = owner.dispose()
    pending.resolve(undefined)
    await expect(sending).rejects.toThrow()
    await closing
    expect(session.setApprovalMode).toHaveBeenCalledOnce()
    expect(session.sendTurn).not.toHaveBeenCalled()
  })
})

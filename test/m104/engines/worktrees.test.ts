import { engineFixtures } from './fixtures'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  createRuntimeWorktrees,
  type RuntimeWorktreeDeps,
} from '../../../src/runtime/features/worktrees'
import { aliasedReviewRepositories } from '../../unit/helpers/reviewRoots'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { UI_TEXT } from '../../../src/shared/constants'

const fixtures = engineFixtures()

async function setup() {
  const base = await fixtures.folder('m104-pb-worktrees-')
  const repositories = await aliasedReviewRepositories(base, 'repo')
  const state = { isCurrent: true, isTrusted: true, isConfirmed: true }
  const runGit = vi.fn<RuntimeWorktreeDeps['runGit']>((args, cwd, _timeout, beforeRun, signal) => {
    signal.throwIfAborted()
    beforeRun()
    return Promise.resolve(execFileSync('git', [...args], { cwd, encoding: 'utf8' }))
  })
  const admit = vi.fn<RuntimeWorktreeDeps['beforeWorkspaceProcessStart']>(() => Promise.resolve())
  const record = vi.fn<RuntimeWorktreeDeps['recordWorktree']>(() => Promise.resolve())
  const open = vi.fn<RuntimeWorktreeDeps['openFolder']>(() => Promise.resolve())
  const cancel = vi.fn()
  const information = vi.fn<RuntimeWorktreeDeps['showInformation']>()
  const errors = vi.fn<RuntimeWorktreeDeps['showError']>()
  const warnings = vi.fn<RuntimeWorktreeDeps['showWarning']>()
  const pick = vi.fn<RuntimeWorktreeDeps['pick']>((items) => Promise.resolve(items[0]?.id))
  const ask = vi.fn<RuntimeWorktreeDeps['askBranchName']>(async (validate) => {
    expect(await validate('portable')).toBeUndefined()
    return 'portable'
  })
  const owner = createRuntimeWorktrees(
    {
      workspaceRoot: repositories.alias,
      platform: process.platform,
      isWorkspaceTrusted: () => state.isTrusted,
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('replaced')
      },
      runGit,
      beforeWorkspaceProcessStart: admit,
      cancelPrompts: cancel,
      pathExists: existsSync,
      askBranchName: ask,
      pick,
      confirm: () => Promise.resolve(state.isConfirmed),
      offerOpen: () => Promise.resolve(true),
      openFolder: open,
      recordWorktree: record,
      showInformation: information,
      showWarning: warnings,
      showError: errors,
      log: new FakeLogOutputChannel(),
    },
    UI_TEXT,
    'en',
  )
  fixtures.own(owner)
  return {
    owner,
    state,
    runGit,
    admit,
    record,
    open,
    cancel,
    pick,
    ask,
    information,
    warnings,
    errors,
    repositories,
  }
}
async function holdAdmission(fixture: Awaited<ReturnType<typeof setup>>) {
  const pending = Promise.withResolvers<undefined>()
  fixture.admit.mockReturnValue(pending.promise)
  const creating = fixture.owner.create()
  await vi.waitFor(() => {
    expect(fixture.admit).toHaveBeenCalledOnce()
  })
  return { pending, creating }
}
describe('portable worktree workflow', () => {
  it('creates, records and opens a real worktree, then removes it with confirmation', async () => {
    const { owner, runGit, admit, record, open, errors } = await setup()
    await owner.create()
    expect(errors).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledOnce()
    const folder = record.mock.calls[0]?.[0]
    expect(typeof folder).toBe('string')
    if (typeof folder !== 'string') throw new Error('worktree was not recorded')
    expect(existsSync(folder)).toBe(true)
    expect(open).toHaveBeenCalledWith(folder)
    expect(admit).toHaveBeenCalledTimes(runGit.mock.calls.length)
    await owner.remove()
    expect(existsSync(folder)).toBe(false)
    expect(errors).not.toHaveBeenCalled()
  })
  it.each(['isCurrent', 'isTrusted'] as const)(
    'refuses a changed %s before any Git or popup',
    async (field) => {
      const { owner, state, runGit, ask } = await setup()
      state[field] = false
      await expect(owner.create()).rejects.toThrow(UI_TEXT.worktreeUntrusted)
      expect(runGit).not.toHaveBeenCalled()
      expect(ask).not.toHaveBeenCalled()
    },
  )
  it('denies checkpoint admission before starting Git', async () => {
    const { owner, admit, runGit, errors } = await setup()
    admit.mockRejectedValue(new Error('native checkpoint refused'))
    await owner.create()
    expect(runGit).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledOnce()
  })
  it('rechecks ownership after held admission and starts no late Git', async () => {
    const fixture = await setup()
    const { runGit, state, errors } = fixture
    const { pending, creating } = await holdAdmission(fixture)
    state.isCurrent = false
    pending.resolve(undefined)
    await expect(creating).rejects.toThrow('replaced')
    expect(runGit).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
  })
  it('refuses a retargeted physical workspace after the native picker', async () => {
    const { owner, ask, repositories, runGit, open, errors } = await setup()
    ask.mockImplementationOnce(() => {
      repositories.retarget()
      return Promise.resolve('portable')
    })
    await expect(owner.create()).rejects.toThrow(UI_TEXT.worktreeUntrusted)
    expect(runGit).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
  })
  it('preserves a worktree when removal consent is denied', async () => {
    const { owner, record, state, runGit } = await setup()
    await owner.create()
    const folder = record.mock.calls[0]?.[0]
    if (typeof folder !== 'string') throw new Error('worktree was not recorded')
    state.isConfirmed = false
    runGit.mockClear()
    await owner.remove()
    expect(existsSync(folder)).toBe(true)
    expect(runGit.mock.calls.some(([args]) => args.includes('remove'))).toBe(false)
  })
  it('cancels native prompts once and drains a held process admission during release', async () => {
    const fixture = await setup()
    const { owner, admit, cancel, runGit } = fixture
    const { pending, creating } = await holdAdmission(fixture)
    const closing = owner.dispose()
    expect(owner.dispose()).toBe(closing)
    expect(cancel).toHaveBeenCalledOnce()
    expect(admit.mock.calls[0]?.[0].aborted).toBe(true)
    pending.resolve(undefined)
    await expect(creating).rejects.toThrow()
    await closing
    expect(runGit).not.toHaveBeenCalled()
    await expect(owner.create()).rejects.toThrow()
  })
})

import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { createRuntimeGit, type RuntimeGitDeps } from '../../../src/runtime/features/git'
import { openOwnedRepository } from '../../../src/host/git/ownedRepository'
import { UI_TEXT } from '../../../src/shared/constants'
import { fakeGitWindow, change } from '../../unit/helpers/fakeGit'
import type { GitSurface } from '../../../src/host/conversation/conversationController'
import { engineFixtures } from './fixtures'

const fixtures = engineFixtures()
function setup(extra: Partial<RuntimeGitDeps> = {}) {
  const fake = fakeGitWindow()
  fake.repository.state.indexChanges.push(change('a.ts'))
  const surface: GitSurface = {
    post: vi.fn(),
    notice: vi.fn(),
    say: vi.fn(),
    sessionId: () => undefined,
  }
  const state = { isCurrent: true, isTrusted: true }
  const admission = vi.fn(() => Promise.resolve())
  const drain = vi.fn(() => Promise.resolve())
  const cancelPrompts = vi.fn()
  const service = createRuntimeGit(
    {
      ...fake.window,
      isWorkspaceTrusted: () => state.isTrusted,
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('retired')
      },
      beforeWorkspaceProcessStart: admission,
      cancelPrompts,
      drain,
      ...extra,
    },
    surface,
    UI_TEXT,
    'en',
  )
  fixtures.own(service)
  return { ...fake, service, surface, state, admission, drain, cancelPrompts }
}

describe('F36 portable Git owner', () => {
  it('bundles the real engine without a VS Code value import', async () => {
    await expect(
      build({
        entryPoints: ['src/runtime/features/git.ts'],
        bundle: true,
        write: false,
        platform: 'node',
        logLevel: 'silent',
        plugins: [
          {
            name: 'forbid-editor-value',
            setup(builder) {
              builder.onResolve({ filter: /^vscode$/ }, () => ({
                errors: [{ text: 'portable engine imports vscode' }],
              }))
            },
          },
        ],
      }),
    ).resolves.toBeDefined()
  })
  it('compares physical repository owners with Windows separators and case', async () => {
    const fake = fakeGitWindow()
    const repository = { ...fake.repository, rootUri: { fsPath: String.raw`c:\src\app` } }
    const opened = await openOwnedRepository(
      'C:/Src/App/',
      'win32',
      () => Promise.resolve(repository),
      (root, check) => {
        check()
        return Promise.resolve({ cwd: root, isCurrent: () => true })
      },
      () => undefined,
    )
    expect(opened.repository).toBe(repository)
    expect(opened.cwd).toBe('C:/Src/App/')
    expect(() => {
      opened.check()
    }).not.toThrow()
  })
  it('uses actual consent and final process admission for the exact staged commit', async () => {
    const rig = setup()
    await rig.service.git.handleAction('openCommit')
    await rig.service.git.commit('Fixture commit', false)
    expect(rig.commitConfirmations[0]).toMatchObject({
      message: 'Fixture commit',
      files: ['a.ts'],
      includesUnstaged: false,
    })
    expect(rig.admission).toHaveBeenCalledOnce()
    expect(rig.repository.calls).toContainEqual({
      method: 'commit',
      args: ['Fixture commit', { postCommitCommand: null }],
    })
  })
  it('refuses late prompt consent and drains the native owner on release', async () => {
    const rig = setup()
    const answer = Promise.withResolvers<boolean>()
    vi.spyOn(rig.window, 'confirmCommit').mockImplementation(() => answer.promise)
    // The immutable factory captured the native callback, so construct an owner with this held prompt.
    const service = createRuntimeGit(
      {
        ...rig.window,
        assertCurrent: () => undefined,
        beforeWorkspaceProcessStart: rig.admission,
        cancelPrompts: () => {
          answer.resolve(true)
        },
        drain: rig.drain,
      },
      rig.surface,
      UI_TEXT,
      'en',
    )
    fixtures.own(service)
    await service.git.handleAction('openCommit')
    const committing = service.git.commit('Late fixture', false)
    const refused = expect(committing).rejects.toThrow()
    await vi.waitFor(() => {
      expect(rig.window.confirmCommit).toHaveBeenCalledOnce()
    })
    await service.dispose()
    await refused
    expect(rig.repository.calls.some((call) => call.method === 'commit')).toBe(false)
    expect(rig.drain).toHaveBeenCalledOnce()
  })
  it('refuses trust withdrawn at the final native admission', async () => {
    const rig = setup()
    rig.admission.mockImplementation(() => {
      rig.state.isTrusted = false
      return Promise.resolve()
    })
    await rig.service.git.handleAction('openCommit')
    await rig.service.git.commit('Fixture commit', false)
    expect(rig.repository.calls.some((call) => call.method === 'commit')).toBe(false)
  })
  it('refuses a repository whose physical owner is different from the selected workspace', async () => {
    let captures = 0
    const rig = setup({
      captureGitOwner: (root, check) => {
        check()
        captures += 1
        return Promise.resolve({
          cwd: captures === 1 ? root : '/different-owner',
          isCurrent: () => true,
        })
      },
    })
    await rig.service.git.handleAction('openCommit')
    expect(rig.surface.post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gitCommitForm' }),
    )
    expect(rig.surface.say).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining(UI_TEXT.gitOperationChanged),
    )
  })
})

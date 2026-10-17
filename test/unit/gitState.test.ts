import { describe, expect, it } from 'vitest'
import type { CommitFormFacts, PullRequestFormFacts } from '../../src/shared/git'
import {
  initialGitUiState,
  withCommitForm,
  withDone,
  withDraft,
  withFormBusy,
  withFormEdit,
  withGeneration,
  withPullRequestForm,
  withSendFailed,
} from '../../src/webview/state/gitState'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'

const COMMIT: CommitFormFacts = {
  branch: 'feature',
  staged: 0,
  unstaged: 1,
  files: [{ path: 'a.ts', isStaged: false }],
  moreFiles: 0,
}
const PULL_REQUEST: PullRequestFormFacts = {
  repository: 'o/r',
  remote: 'origin',
  remoteUrl: 'https://github.com/o/r.git',
  head: 'feature',
  base: 'main',
  push: 'pushed',
}

describe('the git forms in the webview (M71)', () => {
  it('opens the commit form with everything included when nothing is staged, keeping typed text', () => {
    const opened = withCommitForm(initialGitUiState, COMMIT)
    expect(opened.form).toMatchObject({ kind: 'commit', message: '', includeUnstaged: true })
    const typed = withFormEdit(opened, { field: 'message', value: 'Fix' })
    // The host sends the form again (a refresh): what was typed stays.
    expect(withCommitForm(typed, { ...COMMIT, staged: 1 }).form).toMatchObject({ message: 'Fix' })
  })

  it('puts a draft only into the form it is for, and a failure only frees that form', () => {
    const commit = withGeneration(withCommitForm(initialGitUiState, COMMIT), 'l1')
    const wrongKind = withDraft(commit, { kind: 'pullRequest', title: 'T', body: 'B' })
    expect(wrongKind).toBe(commit)
    expect(withDraft(commit, { kind: 'failed', forKind: 'pullRequest' })).toBe(commit)
    expect(withDraft(commit, { kind: 'commitMessage', message: 'M' }).form).toMatchObject({
      message: 'M',
      generation: undefined,
    })
    expect(withDraft(initialGitUiState, { kind: 'commitMessage', message: 'M' })).toBe(
      initialGitUiState,
    )
  })

  it('starts a pull request as a draft on the base the host found', () => {
    const opened = withPullRequestForm(initialGitUiState, PULL_REQUEST)
    expect(opened.form).toMatchObject({ kind: 'pullRequest', base: 'main', isDraft: true })
    const edited = withFormEdit(withFormEdit(opened, { field: 'isDraft', value: false }), {
      field: 'base',
      value: 'release',
    })
    expect(edited.form).toMatchObject({ isDraft: false, base: 'release' })
    // A commit field means nothing to it.
    expect(withFormEdit(edited, { field: 'message', value: 'x' })).toBe(edited)
  })

  it('closes on done, frees the buttons on a failure, and ignores the other form', () => {
    const busy = withFormBusy(withCommitForm(initialGitUiState, COMMIT))
    expect(withDone(busy, 'pullRequest', true)).toBe(busy)
    expect(withDone(busy, 'commit', false).form).toMatchObject({ isBusy: false })
    expect(withDone(busy, 'commit', true).form).toBeUndefined()
  })

  it.each(['commit', 'pullRequest'] as const)(
    'frees Write with Muse when the %s form opens again while its draft is awaited',
    (kind) => {
      const open = (git: typeof initialGitUiState) =>
        kind === 'commit' ? withCommitForm(git, COMMIT) : withPullRequestForm(git, PULL_REQUEST)
      const field = kind === 'commit' ? 'message' : 'title'
      const typed = withFormEdit(open(initialGitUiState), { field, value: 'Typed' })
      const waiting = withGeneration(typed, 'old-local-id')
      expect(waiting.form?.generation).toBe('old-local-id')
      // The host opened a new form; the old draft's reply is never posted to it.
      const reopened = open(waiting)
      expect(reopened.form).toMatchObject({ kind, [field]: 'Typed', generation: undefined })
      // Through the reducer, as the host's message arrives.
      const state = uiReducer(
        { ...initialUiState, git: waiting },
        {
          type: 'hostMessage',
          at: 0,
          message:
            kind === 'commit'
              ? { type: 'gitCommitForm', form: COMMIT }
              : { type: 'gitPullRequestForm', form: PULL_REQUEST },
        },
      )
      expect(state.git.form?.generation).toBeUndefined()
    },
  )

  it('gives Generate back only for the message that asked', () => {
    const waiting = withGeneration(withCommitForm(initialGitUiState, COMMIT), 'l1')
    expect(withSendFailed(waiting, 'l2')).toBe(waiting)
    expect(withSendFailed(waiting, 'l1').form?.generation).toBeUndefined()
  })

  it('drops the open form with the conversation, and keeps what the host says', () => {
    const state = uiReducer(initialUiState, {
      type: 'hostMessage',
      at: 0,
      message: { type: 'gitState', state: { worktree: { repositoryRoot: '/r', branch: 'b' } } },
    })
    const withForm = uiReducer(state, {
      type: 'hostMessage',
      at: 0,
      message: { type: 'gitCommitForm', form: COMMIT },
    })
    const cleared = uiReducer(withForm, { type: 'conversationCleared' })
    expect(cleared.git.form).toBeUndefined()
    expect(cleared.git.state.worktree).toEqual({ repositoryRoot: '/r', branch: 'b' })
  })
})

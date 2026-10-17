// The git and pull request panel's state in the webview (M71, PLAN.md
// D49): what the host last said (the held-worktree card, the worktree
// line, the linked pull request) and the open form with what the user
// typed in it. Pure; the main reducer (uiState.ts) routes to it.

import type {
  CommitFormFacts,
  GitDraft,
  GitForm,
  GitState,
  PullRequestFormFacts,
} from '../../shared/git'

export type GitFormState =
  | {
      readonly kind: 'commit'
      readonly facts: CommitFormFacts
      readonly message: string
      /** Stage every change first, new files included. */
      readonly includeUnstaged: boolean
      readonly isBusy: boolean
      /** The local id of the message asking for a draft, while its reply is awaited. */
      readonly generation: string | undefined
    }
  | {
      readonly kind: 'pullRequest'
      readonly facts: PullRequestFormFacts
      readonly title: string
      readonly body: string
      readonly base: string
      readonly isDraft: boolean
      readonly isBusy: boolean
      readonly generation: string | undefined
    }

export interface GitUiState {
  readonly state: GitState
  readonly form: GitFormState | undefined
}

export const initialGitUiState: GitUiState = { state: {}, form: undefined }

/** A field of the open form the user changed. */
export type GitFormEdit =
  | { readonly field: 'message' | 'title' | 'body' | 'base'; readonly value: string }
  | { readonly field: 'includeUnstaged' | 'isDraft'; readonly value: boolean }

export function withGitState(git: GitUiState, state: GitState): GitUiState {
  return { ...git, state }
}

/**
 * The host opened the commit form: a form already open keeps what was
 * typed, but not a draft it was waiting for. Opening again started a new
 * form on the host, which never fills it with the earlier form's draft, so
 * Write with Muse is free again.
 */
export function withCommitForm(git: GitUiState, facts: CommitFormFacts): GitUiState {
  const open = git.form?.kind === 'commit' ? git.form : undefined
  return {
    ...git,
    form: {
      kind: 'commit',
      facts,
      message: open?.message ?? '',
      // Nothing staged: every change goes in, as the form says.
      includeUnstaged: open?.includeUnstaged ?? facts.staged === 0,
      isBusy: false,
      generation: undefined,
    },
  }
}

/** The same for the pull request form. */
export function withPullRequestForm(git: GitUiState, facts: PullRequestFormFacts): GitUiState {
  const open = git.form?.kind === 'pullRequest' ? git.form : undefined
  return {
    ...git,
    form: {
      kind: 'pullRequest',
      facts,
      title: open?.title ?? '',
      body: open?.body ?? '',
      base: open?.base ?? facts.base,
      isDraft: open?.isDraft ?? true,
      isBusy: false,
      generation: undefined,
    },
  }
}

/** A draft from the model (or the host's masking) fills the form it is for. */
export function withDraft(git: GitUiState, draft: GitDraft): GitUiState {
  const { form } = git
  if (form === undefined) {
    return git
  }
  if (draft.kind === 'failed') {
    return form.kind === (draft.forKind === 'commitMessage' ? 'commit' : 'pullRequest')
      ? { ...git, form: { ...form, generation: undefined } }
      : git
  }
  if (draft.kind === 'commitMessage' && form.kind === 'commit') {
    return { ...git, form: { ...form, message: draft.message, generation: undefined } }
  }
  if (draft.kind === 'pullRequest' && form.kind === 'pullRequest') {
    return {
      ...git,
      form: { ...form, title: draft.title, body: draft.body, generation: undefined },
    }
  }
  return git
}

/** The commit or creation ended: done closes the form, a failure frees its buttons. */
export function withDone(git: GitUiState, form: GitForm, isOk: boolean): GitUiState {
  const open = git.form
  if (open?.kind !== form) {
    return git
  }
  return isOk ? { ...git, form: undefined } : { ...git, form: { ...open, isBusy: false } }
}

export function withFormEdit(git: GitUiState, edit: GitFormEdit): GitUiState {
  const { form } = git
  if (form === undefined) {
    return git
  }
  if (form.kind === 'commit') {
    if (edit.field === 'message') {
      return { ...git, form: { ...form, message: edit.value } }
    }
    return edit.field === 'includeUnstaged'
      ? { ...git, form: { ...form, includeUnstaged: edit.value } }
      : git
  }
  switch (edit.field) {
    case 'title': {
      return { ...git, form: { ...form, title: edit.value } }
    }
    case 'body': {
      return { ...git, form: { ...form, body: edit.value } }
    }
    case 'base': {
      return { ...git, form: { ...form, base: edit.value } }
    }
    case 'isDraft': {
      return { ...git, form: { ...form, isDraft: edit.value } }
    }
    default: {
      return git
    }
  }
}

export function withFormBusy(git: GitUiState): GitUiState {
  return git.form === undefined ? git : { ...git, form: { ...git.form, isBusy: true } }
}

export function withGeneration(git: GitUiState, localId: string): GitUiState {
  return git.form === undefined ? git : { ...git, form: { ...git.form, generation: localId } }
}

/** The message asking for a draft was refused: the form's Generate comes back. */
export function withSendFailed(git: GitUiState, localId: string): GitUiState {
  return git.form?.generation === localId
    ? { ...git, form: { ...git.form, generation: undefined } }
    : git
}

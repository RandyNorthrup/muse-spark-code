// What the git and pull request panel shows (M71, PLAN.md D49), as the host
// sends it: the held-worktree card, the worktree the window is on, the pull
// request linked to the conversation with its status and checks, and the
// commit and pull request forms. Shared by the host and the webview; the
// webview validates every message with these schemas.

import * as z from 'zod/mini'

export const GIT_ACTIONS = [
  'openCommit',
  'push',
  'openPullRequest',
  'refreshPullRequest',
  'signInGitHub',
  'trustWorktree',
  'cancel',
] as const
export type GitAction = (typeof GIT_ACTIONS)[number]

/** What a generation turn drafts (M71): asked for only by the user's own message. */
export const GIT_DRAFT_KINDS = ['commitMessage', 'pullRequest'] as const
export type GitDraftKind = (typeof GIT_DRAFT_KINDS)[number]

export const GIT_FORMS = ['commit', 'pullRequest'] as const
export type GitForm = (typeof GIT_FORMS)[number]

/** Whether the branch has to go up before a pull request can name it. */
export const PULL_REQUEST_PUSH_STATES = ['pushed', 'needed', 'behind'] as const

const checksViewSchema = z.object({
  passed: z.number(),
  failed: z.number(),
  running: z.number(),
  skipped: z.number(),
  cancelled: z.number(),
  failedNames: z.array(z.string()),
  other: z.array(z.string()),
  notRead: z.number(),
})

const pullRequestViewSchema = z.object({
  repository: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  /** GitHub's `state` as it came (`open`, `closed`), with draft and merged beside it. */
  state: z.optional(z.string()),
  isDraft: z.optional(z.boolean()),
  isMerged: z.optional(z.boolean()),
  checks: z.optional(checksViewSchema),
  /** Why the status is not shown: GitHub's refusal or the network, in words. */
  problem: z.optional(z.string()),
  /** No GitHub sign-in yet: the strip offers one. */
  needsSignIn: z.optional(z.boolean()),
  /** Epoch ms of the status shown. */
  checkedAt: z.optional(z.number()),
})
export type PullRequestView = z.infer<typeof pullRequestViewSchema>

const holdViewSchema = z.object({
  /** The pull request the worktree holds, when its record is there. */
  pullRequest: z.optional(
    z.object({
      repository: z.string(),
      number: z.number(),
      title: z.string(),
      author: z.string(),
      url: z.string(),
    }),
  ),
  /** VS Code opened the folder in Restricted Mode as well. */
  isRestricted: z.boolean(),
})

const worktreeViewSchema = z.object({
  /** The branch, or undefined for a pull request's detached head. */
  branch: z.optional(z.string()),
  repositoryRoot: z.string(),
  pullRequestNumber: z.optional(z.number()),
})

export const gitStateSchema = z.object({
  hold: z.optional(holdViewSchema),
  worktree: z.optional(worktreeViewSchema),
  pullRequest: z.optional(pullRequestViewSchema),
})
export type GitState = z.infer<typeof gitStateSchema>

export const commitFormSchema = z.object({
  branch: z.optional(z.string()),
  staged: z.number(),
  /** Changes not staged, new files included. */
  unstaged: z.number(),
  files: z.array(z.object({ path: z.string(), isStaged: z.boolean() })),
  moreFiles: z.number(),
})
export type CommitFormFacts = z.infer<typeof commitFormSchema>

export const pullRequestFormSchema = z.object({
  /** Where the pull request opens: the remote's repository, or its parent for a fork. */
  repository: z.string(),
  /** The fork the branch is in, when it is not `repository`. */
  headRepository: z.optional(z.string()),
  remote: z.string(),
  /** The remote's URL, credentials masked. */
  remoteUrl: z.string(),
  head: z.string(),
  base: z.string(),
  push: z.enum(PULL_REQUEST_PUSH_STATES),
  /** Commits a push would send; undefined on a first push. */
  commits: z.optional(z.number()),
})
export type PullRequestFormFacts = z.infer<typeof pullRequestFormSchema>

export const gitDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commitMessage'), message: z.string() }),
  z.object({ kind: z.literal('pullRequest'), title: z.string(), body: z.string() }),
  z.object({ kind: z.literal('failed'), forKind: z.enum(GIT_DRAFT_KINDS) }),
])
export type GitDraft = z.infer<typeof gitDraftSchema>

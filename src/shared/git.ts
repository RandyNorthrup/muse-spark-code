// What the git and pull request panel shows (M71, PLAN.md D49), as the host
// sends it: the held-worktree card, the worktree the window is on, the pull
// request linked to the conversation with its status and checks, and the
// commit and pull request forms. Shared by the host and the webview; the
// webview validates every message with these schemas.

import * as z from 'zod/mini'
import { GITHUB_TOKEN_SOURCE_ORDER } from './constants'

export const GIT_ACTIONS = [
  'openCommit',
  'push',
  'openPullRequest',
  'refreshPullRequest',
  'signInGitHub',
  // M123 (PLAN.md D104 §2): sign in with GitHub's device flow even where the
  // editor has its own sign-in; stop a sign-in waiting for its code; sign
  // out of Muse Spark's own sign-in.
  'signInGitHubWithCode',
  'cancelGitHubSignIn',
  'signOutGitHub',
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

/** The window's GitHub sign-in as the panel shows it (M123, D104 §2); never a token. */
const githubViewSchema = z.object({
  /** A device-flow code waiting for the user: the code, GitHub's page, and when it expires (epoch ms). */
  code: z.optional(
    z.object({ userCode: z.string(), verificationUri: z.string(), expiresAt: z.number() }),
  ),
  /** The source the last GitHub call used, and the account's login when known. */
  account: z.optional(
    z.object({ source: z.enum(GITHUB_TOKEN_SOURCE_ORDER), login: z.optional(z.string()) }),
  ),
})
export type GitHubView = z.infer<typeof githubViewSchema>

export const gitStateSchema = z.object({
  hold: z.optional(holdViewSchema),
  worktree: z.optional(worktreeViewSchema),
  pullRequest: z.optional(pullRequestViewSchema),
  github: z.optional(githubViewSchema),
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

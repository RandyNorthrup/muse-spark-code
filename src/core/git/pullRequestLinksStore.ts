// Pull request links the runtime keeps (M123, PLAN.md D104): which pull
// request a conversation opened, keyed by the canonical repository root
// and the session id. The runtime's per-user store keeps the newest
// PULL_REQUEST_LINKS_KEPT links of each root; session export and import
// carry a link through it. VS Code's workspace-state links
// (src/host/git/pullRequestLinks.ts) validate and prune through here, so
// both hosts keep the same bound; every editor reads the status from
// GitHub each time.
//
// Pure: storage is injected through the lane 0 port.

import * as z from 'zod/mini'
import { PULL_REQUEST_LINKS_KEPT } from '../../shared/constants'
import type { PullRequestLinkRecord, PullRequestLinkStore } from './runtimeGit'

export const pullRequestLinkRecordSchema = z.object({
  /** `owner/name` on github.com. */
  repository: z.string(),
  number: z.number(),
  url: z.string(),
  title: z.string(),
  /** Epoch ms, for dropping the oldest past PULL_REQUEST_LINKS_KEPT. */
  linkedAt: z.number(),
})

/** The stored links; a value that does not validate reads as none. */
export function parsePullRequestLinkRecords(raw: unknown): Record<string, PullRequestLinkRecord> {
  const parsed = z.record(z.string(), pullRequestLinkRecordSchema).safeParse(raw ?? {})
  return parsed.success ? { ...parsed.data } : {}
}

/** The links with only the newest PULL_REQUEST_LINKS_KEPT kept. */
export function prunePullRequestLinks(
  links: Readonly<Record<string, PullRequestLinkRecord>>,
): Record<string, PullRequestLinkRecord> {
  return Object.fromEntries(
    Object.entries(links)
      .toSorted(([, left], [, right]) => right.linkedAt - left.linkedAt)
      .slice(0, PULL_REQUEST_LINKS_KEPT),
  )
}

/** `/` separators, which git accepts on Windows too, so the keys compare. */
function keyOf(repositoryRoot: string): string {
  return repositoryRoot.replaceAll('\\', '/')
}

/**
The lane 0 port in memory: per repository root, the newest
PULL_REQUEST_LINKS_KEPT links. The runtime owns persistence (its
per-user store); session export and import carry a link through it.
*/
export function createMemoryPullRequestLinkStore(): PullRequestLinkStore {
  const roots = new Map<string, Map<string, PullRequestLinkRecord>>()
  return {
    get: (repositoryRoot, sessionId) =>
      Promise.resolve(roots.get(keyOf(repositoryRoot))?.get(sessionId)),
    set: (repositoryRoot, sessionId, link) => {
      const links = new Map(roots.get(keyOf(repositoryRoot)))
      links.set(sessionId, link)
      const kept = prunePullRequestLinks(Object.fromEntries(links))
      roots.set(keyOf(repositoryRoot), new Map(Object.entries(kept)))
      return Promise.resolve()
    },
  }
}

export { type PullRequestLinkRecord } from './runtimeGit'

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { existsSync } from 'node:fs'
import * as z from 'zod/mini'
import {
  REPORT_NETWORK_MAX_BYTES,
  REPORT_NETWORK_MAX_PAGES,
  REPORT_NETWORK_CACHE_ENTRIES,
} from '../../shared/constants'
import { ReportStorage } from '../../core/reporting/history'
import {
  ReportResponseCache,
  ReportNetworkReader,
  reportCacheEntrySchema,
  type ReportNetworkPolicy,
  type ReportNetworkTransport,
} from '../../core/reporting/sources/cache'
import { githubReportSource, ghReportTransport } from '../../core/reporting/sources/github'
import { reportScrubber } from '../../core/reporting/render/redaction'
import { reportGitIo } from './sources'
import type { GitFacts, ReportSourcePorts } from '../../core/reporting/sources/types'
import { localSource, LocalSourceError } from '../../core/reporting/sources/local'
import { homedir } from 'node:os'

export interface ReportingNetworkContext {
  readonly workspaceRoot: string
  readonly storageRoot: string
  readonly l10n: { readonly table: UiText; readonly locale: string }
  readonly policy: ReportNetworkPolicy
  readonly transport?: ReportNetworkTransport
}
const caches = new Map<string, ReportResponseCache>()
/** H's owner lease serializes cache publication across windows/processes. */
export function reportingResponseCache(storageRoot: string): ReportResponseCache {
  let cache = caches.get(storageRoot)
  if (cache !== undefined) return cache
  const storage = new ReportStorage(storageRoot)
  const schema = z.array(reportCacheEntrySchema).check(z.maxLength(REPORT_NETWORK_CACHE_ENTRIES))
  cache = new ReportResponseCache(
    {
      read: (signal) =>
        storage.transaction(['cache'], false, async (files) => {
          signal.throwIfAborted()
          const text = await files.read('index.json')
          signal.throwIfAborted()
          return text === undefined ? undefined : schema.parse(JSON.parse(text))
        }),
      write: (entries, signal) =>
        storage.transaction(['cache'], true, async (files) => {
          signal.throwIfAborted()
          const prior = await files.read('index.json')
          const merged = new Map(
            (prior === undefined ? [] : schema.parse(JSON.parse(prior))).map((entry) => [
              entry.key,
              entry,
            ]),
          )
          for (const entry of schema.parse(entries)) {
            const before = merged.get(entry.key)
            if (
              before === undefined ||
              Date.parse(before.observedAt) <= Date.parse(entry.observedAt)
            )
              merged.set(entry.key, entry)
          }
          const values = []
          for (const value of merged.values()) values.push(value)
          const bounded = values
            .toSorted(
              (a, b) =>
                Date.parse(a.observedAt) - Date.parse(b.observedAt) || (a.key < b.key ? -1 : 1),
            )
            .slice(-REPORT_NETWORK_CACHE_ENTRIES)
          signal.throwIfAborted()
          await files.write('index.json', JSON.stringify(bounded))
          signal.throwIfAborted()
        }),
    },
    REPORT_NETWORK_CACHE_ENTRIES,
  )
  caches.set(storageRoot, cache)
  return cache
}

/** CLI uses gh's own identity; editors inject their credential-owning HTTPS transport. */
export function createReportingNetwork(
  context: ReportingNetworkContext,
  git: GitFacts | null | (() => GitFacts | null),
): Pick<ReportSourcePorts, 'github' | 'stores'> {
  setUiText(context.l10n.table, context.l10n.locale)
  const scrub = reportScrubber({ workspaceRoot: context.workspaceRoot, localRoots: [homedir()] })
  const reader = new ReportNetworkReader({
    policy: context.policy,
    transport:
      context.transport ??
      ghReportTransport({
        environment: process.env,
        maxBytes: REPORT_NETWORK_MAX_BYTES,
        probe: {
          platform: process.platform,
          pathVariable: process.env['PATH'] ?? process.env['Path'],
          fileExists: existsSync,
        },
      }),
    cache: reportingResponseCache(context.storageRoot),
    now: () => new Date().toISOString(),
    scrub,
    maxBytes: REPORT_NETWORK_MAX_BYTES,
    maxPages: REPORT_NETWORK_MAX_PAGES,
  })
  return {
    github: {
      kind: 'github',
      id: 'github',
      async read(readContext) {
        try {
          const facts = typeof git === 'function' ? git() : git
          if (facts === null) throw new LocalSourceError('unbound')
          if (context.policy.surface === 'editor' && context.transport === undefined)
            throw new LocalSourceError('unbound')
          const remote = await reportGitIo(
            context.workspaceRoot,
            process.platform,
            process.env,
          ).run(['remote', 'get-url', 'origin'], readContext.signal)
          if (remote.code !== 0) throw new LocalSourceError('missing')
          return await githubReportSource({
            reader,
            remote: remote.stdout.trim(),
            headSha: facts.head,
            defaultBranch: facts.defaultBranch,
          }).read(readContext)
        } catch (error) {
          return await localSource('github', () =>
            Promise.reject(error instanceof Error ? error : new LocalSourceError('unbound')),
          ).read(readContext)
        }
      },
    },
    // Store/workflow/release adapters require N's approved captures, never inferred schemas.
    stores: localSource('stores', () => Promise.reject(new LocalSourceError('unbound'))),
  }
}

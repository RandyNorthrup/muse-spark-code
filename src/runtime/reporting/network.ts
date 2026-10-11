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
  ReportNetworkFailure,
  publicReportTransport,
  type ReportNetworkPolicy,
  type ReportNetworkTransport,
} from '../../core/reporting/sources/cache'
import { githubReportSource, ghReportTransport } from '../../core/reporting/sources/github'
import { storesReportSource, type ReportStoreAdapter } from '../../core/reporting/sources/stores'
import { GITHUB_API_BASE_URL, LEGAL_REGISTRY_HOSTS } from '../../shared/constants'
import { githubWorkflowReleasesPort } from '../../core/reporting/sources/githubWorkflowReleases'
import {
  MARKETPLACE_HOST,
  marketplaceStoreAdapter,
} from '../../core/reporting/sources/marketplaceStore'
import { npmStoreAdapter } from '../../core/reporting/sources/npmStore'
import { OPEN_VSX_HOST, openVsxStoreAdapter } from '../../core/reporting/sources/openVsxStore'
import type { ReportStoreProject } from '../../core/reporting/sources/storeProject'
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
const GITHUB_API_HOST = new URL(GITHUB_API_BASE_URL).hostname
const NPM_REGISTRY_HOST = LEGAL_REGISTRY_HOSTS.npm

/**
 * Production transport composition (RVCM1136 P1, RVCM1136B P1): one
 * transport behind the reader, routed by host. `api.github.com` keeps the
 * surface's own lane — the editor's credential-owning fetch, or the CLI/ACP
 * `gh` child process — so GitHub traffic never leaves its lane (the GitHub
 * sweep: its binding is unchanged, only addressed) and the editor Bearer [REDACTED]
 * never reaches a gallery. The public store hosts (npm plus both galleries
 * the production binding binds) ride the credential-free public fetch, under
 * the same policy and egress consent the reader already enforces before any
 * transport runs. The reader's own allow-list, gallery-POST rule and size
 * bounds still apply first; any other host is refused, exactly as the `gh`
 * lane refused it before.
 */
export function routeReportTransport(github: ReportNetworkTransport): ReportNetworkTransport {
  const publicTransport = publicReportTransport((input, init) => globalThis.fetch(input, init))
  return async (request, etag, signal) => {
    const hostname = new URL(request.url).hostname
    if (hostname === GITHUB_API_HOST) return await github(request, etag, signal)
    if ([NPM_REGISTRY_HOST, MARKETPLACE_HOST, OPEN_VSX_HOST].includes(hostname))
      return await publicTransport(request, etag, signal)
    throw new ReportNetworkFailure('gh-endpoint-refused')
  }
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

/**
 * CLI uses gh's own identity; editors inject their credential-owning HTTPS
 * transport. Without a workspace project the stores source stays unbound, as
 * before; with one, every channel reads through its captured adapter
 * (Marketplace, Open VSX, npm) and GitHub reads workflow runs and releases
 * through the captured port. A private manifest's npm row refuses with
 * `npm-private-manifest` (the manifest publishes no npm package under its
 * own name); uncaptured shapes refuse with their own reasons.
 */
/**
 * The captured channel adapters for one workspace identity, mirroring the
 * source's own channel applicability: the gallery channels only for an
 * extension identity (publisher plus `engines.vscode`), the npm channel
 * always (the source itself refuses it for a private manifest, whose
 * published name it cannot know without hard-coding one).
 */
function storeAdapters(project: ReportStoreProject): ReportStoreAdapter[] {
  const adapters: ReportStoreAdapter[] = [npmStoreAdapter(project.name)]
  if (
    project.publisher !== undefined &&
    project.publisher !== '' &&
    project.engines?.vscode !== undefined
  )
    adapters.unshift(
      marketplaceStoreAdapter(project.publisher, project.name),
      openVsxStoreAdapter(project.publisher, project.name),
    )
  return adapters
}

export function createReportingNetwork(
  context: ReportingNetworkContext,
  git: GitFacts | null | (() => GitFacts | null),
  project?: ReportStoreProject,
): Pick<ReportSourcePorts, 'github' | 'stores'> {
  setUiText(context.l10n.table, context.l10n.locale)
  const scrub = reportScrubber({ workspaceRoot: context.workspaceRoot, localRoots: [homedir()] })
  const reader = new ReportNetworkReader({
    policy: context.policy,
    transport: routeReportTransport(
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
    ),
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
            additional: githubWorkflowReleasesPort(),
          }).read(readContext)
        } catch (error) {
          return await localSource('github', () =>
            Promise.reject(error instanceof Error ? error : new LocalSourceError('unbound')),
          ).read(readContext)
        }
      },
    },
    stores:
      project === undefined
        ? localSource('stores', () => Promise.reject(new LocalSourceError('unbound')))
        : storesReportSource({
            reader,
            project: {
              name: project.name,
              ...(project.publisher !== undefined && { publisher: project.publisher }),
              ...(project.engines !== undefined && { engines: project.engines }),
              ...(project.private !== undefined && { private: project.private }),
            },
            releaseVersion: project.releaseVersion,
            adapters: storeAdapters(project),
          }),
  }
}

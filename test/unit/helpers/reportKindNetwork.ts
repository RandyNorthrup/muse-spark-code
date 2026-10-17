import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, vi, type Mock } from 'vitest'
import {
  ReportNetworkReader,
  ReportResponseCache,
  type ReportNetworkDeps,
  type ReportNetworkPolicy,
} from '../../../src/core/reporting/sources/cache'
import { redactSecrets } from '../../../src/core/redact'
import type { SourceReadContext } from '../../../src/core/reporting/sources/types'
import { createReportingNetwork } from '../../../src/runtime/reporting/network'
import {
  githubReportSource,
  type ReportGitHubOptions,
} from '../../../src/core/reporting/sources/github'
import { githubWorkflowReleasesPort } from '../../../src/core/reporting/sources/githubWorkflowReleases'
import { REPORT_NETWORK_MAX_BYTES } from '../../../src/shared/constants'
import {
  storesReportSource,
  type ReportStoreAdapter,
  type ReportStoreOptions,
} from '../../../src/core/reporting/sources/stores'
import type { ReportStoreProject } from '../../../src/core/reporting/sources/storeProject'
import { EN } from '../../../src/shared/l10n/en'
import { REPORT_FIXTURE_AS_OF } from './reporting/kindFixtures'

export function networkContext(isNetworkEnabled = true): SourceReadContext {
  return {
    reportText: EN,
    locale: 'en',
    asOf: REPORT_FIXTURE_AS_OF,
    workspaceKey: 'network-fixture',
    options: {
      kind: 'project',
      scope: '',
      asOf: REPORT_FIXTURE_AS_OF,
      full: false,
      network: isNetworkEnabled,
      failOn: [],
    },
    signal: new AbortController().signal,
  }
}

export function networkRig(overrides: Partial<Omit<ReportNetworkDeps, 'cache'>> = {}) {
  let entries: unknown = undefined
  const storage = {
    read: vi.fn(() => Promise.resolve(entries)),
    write: vi.fn((value: unknown) => {
      entries = structuredClone(value)
      return Promise.resolve()
    }),
  }
  const policy: ReportNetworkPolicy = {
    surface: 'editor',
    mode: 'always',
    githubSignedIn: true,
    allowEgress: vi.fn(() => Promise.resolve(true)),
  }
  const transport = vi.fn(() => Promise.resolve(Response.json({ value: 'ok' })))
  const deps: ReportNetworkDeps = {
    policy,
    transport,
    cache: new ReportResponseCache(storage, 4),
    now: () => REPORT_FIXTURE_AS_OF,
    scrub: redactSecrets,
    maxBytes: 16_384,
    maxPages: 8,
    ...overrides,
  }
  return {
    deps,
    reader: new ReportNetworkReader(deps),
    storage,
    transport,
    entries: () => entries,
    replaceEntries: (value: unknown) => {
      entries = value
    },
  }
}

export interface GithubReleaseCaptures {
  readonly tags: unknown
  readonly releasesPage1: unknown
  readonly releaseRuns: unknown
  readonly base: string
  readonly headSha: string
}

function readCaptureBody(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../fixtures/m113/stores/${name}/response.body.json`, import.meta.url),
      'utf8',
    ),
  )
}

/** The three captured bodies every workflow/release case reads, plus the repo coordinates. */
export function githubReleaseCaptures(): GithubReleaseCaptures {
  return {
    tags: readCaptureBody('github-tags-page1'),
    releasesPage1: readCaptureBody('github-releases-page1'),
    releaseRuns: readCaptureBody('github-workflow-release-runs'),
    base: 'https://api.github.com/repos/RandyNorthrup/muse-spark-code',
    headSha: '82d50d5e456d17205623064b0a70caf8a6e34471',
  }
}

/** Empty pulls/check-runs answers shared by every GitHub capture transport. */
export function githubEmptyReads(request: { readonly url: string }): Promise<Response> | undefined {
  if (request.url.includes('/pulls?')) return Promise.resolve(Response.json([]))
  return request.url.includes('/check-runs?')
    ? Promise.resolve(Response.json({ total_count: 0, check_runs: [] }))
    : undefined
}

/**
 * A GitHub capture transport: empty pulls/checks, the given bodies for
 * tags, releases and release-workflow runs, then the caller's fallback.
 * Cases differ only in which bodies they serve and what an unexpected
 * request means, so those stay parameters instead of repeated branches.
 */
export function githubCaptureTransport(input: {
  readonly tags?: unknown
  readonly releases?: unknown
  readonly runs?: unknown
  readonly onUnknown?: (request: { readonly url: string }) => Promise<Response>
}) {
  const routes = (request: { readonly url: string }): Promise<Response> => {
    // A route serves only the body its case provides; anything else falls
    // through to the case's fallback (a 404 case must see its runs 404).
    if (request.url.includes('/tags?') && input.tags !== undefined)
      return Promise.resolve(Response.json(input.tags))
    if (request.url.includes('/releases?') && input.releases !== undefined)
      return Promise.resolve(Response.json(input.releases))
    if (request.url.includes('/actions/workflows/release.yml/runs?') && input.runs !== undefined)
      return Promise.resolve(Response.json(input.runs))
    if (input.onUnknown !== undefined) return input.onUnknown(request)
    throw new Error(`unexpected request ${request.url}`)
  }
  return vi.fn((request: { readonly url: string }) => githubEmptyReads(request) ?? routes(request))
}

/**
 * One workflow/release case: the captured bodies, the repo coordinates and
 * the source options. Cases differ only in the release tag they pin, so that
 * stays a parameter instead of a repeated options literal.
 */
export function githubReleaseCase(releaseTag?: string) {
  const captures = githubReleaseCaptures()
  return {
    tags: captures.tags,
    releasesPage1: captures.releasesPage1,
    releaseRuns: captures.releaseRuns,
    base: captures.base,
    headSha: captures.headSha,
    options: {
      remote: 'https://github.com/RandyNorthrup/muse-spark-code.git',
      headSha: captures.headSha,
      defaultBranch: 'main',
      ...(releaseTag !== undefined && { releaseTag }),
    },
  }
}

/**
 * One GitHub releases read through a rig: the networkRig plus
 * source.read call every workflow/release case repeats. Cases differ only
 * in the transport they drive and the page bound they prove.
 */
export function readGithubReleases(input: {
  readonly transport: ReportNetworkDeps['transport']
  readonly options: Omit<ReportGitHubOptions, 'reader' | 'additional'>
  readonly maxPages?: number | undefined
}) {
  const rig = networkRig({
    transport: input.transport,
    maxBytes: REPORT_NETWORK_MAX_BYTES,
    ...(input.maxPages !== undefined && { maxPages: input.maxPages }),
  })
  return githubReportSource({
    ...input.options,
    reader: rig.reader,
    additional: githubWorkflowReleasesPort(),
  }).read(networkContext())
}

/**
 * The three gallery/npm channel rows every bound-surface case reads,
 * through the production binding. Cases differ only in the surface and
 * fake HTTP boundary they drive, which stay at the call site.
 */
export async function readBoundChannelRows(
  bound: Pick<ReturnType<typeof bindStoresNetwork>, 'stores'>,
) {
  const result = await bound.stores.read(networkContext())
  expect(result.record.status).toBe('partial')
  expect(result.data?.map((row) => [row.channel, row.status, row.version])).toEqual([
    ['Marketplace', 'unavailable', null],
    ['Open VSX', 'unavailable', null],
    ['npm', 'lagging', '0.14.1'],
  ])
  return result
}

/** One stores read through a rig: the networkRig plus source.read call every store case repeats. */
export function readStoresReport(input: {
  readonly transport: ReportNetworkDeps['transport']
  readonly project: ReportStoreOptions['project']
  readonly releaseVersion: string
  readonly adapters: readonly ReportStoreAdapter[]
}) {
  const rig = networkRig({ transport: input.transport })
  return storesReportSource({
    reader: rig.reader,
    project: input.project,
    releaseVersion: input.releaseVersion,
    adapters: input.adapters,
  }).read(networkContext())
}

/** Both npm-adapter suites assert the same refused-package shape. */
export function expectNpmPackageRequired(
  result: Awaited<ReturnType<typeof readStoresReport>>,
  transport: Mock,
): void {
  expect(result.record.status).toBe('partial')
  expect(result.data?.find((row) => row.channel === 'npm')).toEqual({
    channel: 'npm',
    version: null,
    url: 'https://www.npmjs.com/package/fixture',
    status: 'unavailable',
    reason: 'npm-package-required',
  })
  expect(transport).toHaveBeenCalledTimes(2)
}

/** The production store binding every storeProject case drives, up to its fake HTTP boundary. */
export function bindStoresNetwork(input: {
  readonly root: string
  readonly surface: 'editor' | 'terminal'
  readonly mode?: 'always' | 'whenSignedIn'
  readonly transport?: ReportNetworkDeps['transport'] | undefined
  readonly project?: ReportStoreProject | undefined
}) {
  return createReportingNetwork(
    {
      workspaceRoot: input.root,
      storageRoot: path.join(input.root, 'data'),
      l10n: { table: EN, locale: 'en' },
      policy: {
        surface: input.surface,
        mode: input.mode ?? 'always',
        githubSignedIn: false,
        allowEgress: () => Promise.resolve(true),
      },
      ...(input.transport !== undefined && { transport: input.transport }),
    },
    null,
    input.project,
  )
}

export function pauseNetworkAdmission(
  rig: ReturnType<typeof networkRig>,
  stage: 'cache' | 'egress',
) {
  const gate = {
    entered: Promise.withResolvers<undefined>(),
    release: Promise.withResolvers<undefined>(),
  }
  const pause = async (): Promise<void> => {
    gate.entered.resolve(undefined)
    await gate.release.promise
  }
  if (stage === 'cache')
    rig.storage.read.mockImplementationOnce(async () => {
      await pause()
      return undefined
    })
  else
    vi.spyOn(rig.deps.policy, 'allowEgress').mockImplementationOnce(async () => {
      await pause()
      return true
    })
  return {
    entered: gate.entered.promise,
    release: () => {
      gate.release.resolve(undefined)
    },
  }
}

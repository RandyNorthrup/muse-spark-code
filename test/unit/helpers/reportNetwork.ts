import { vi } from 'vitest'
import {
  ReportNetworkReader,
  ReportResponseCache,
  type ReportNetworkDeps,
  type ReportNetworkPolicy,
} from '../../../src/core/reporting/sources/cache'
import { redactSecrets } from '../../../src/core/redact'
import type { SourceReadContext } from '../../../src/core/reporting/sources/types'
import { REPORT_FIXTURE_AS_OF } from './reporting/snapshot'

export function networkContext(isNetworkEnabled = true): SourceReadContext {
  return {
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

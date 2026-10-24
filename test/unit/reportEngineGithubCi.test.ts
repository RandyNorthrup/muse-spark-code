// M116 (D218): the report engine tells the team runner's CI holder what a
// generation observed: the CI check runs through the real github source
// over the recorded 2026-09-28 capture, a failure when the read fails,
// and nothing when no generation attempted the read.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ReportNetworkTransport } from '../../src/core/reporting/sources/cache'
import { githubReportSource } from '../../src/core/reporting/sources/github'
import { storesReportSource } from '../../src/core/reporting/sources/stores'
import { createReportingServices } from '../../src/runtime/reporting/engine'
import { EN } from '../../src/shared/l10n/en'
import type { ReportOptions } from '../../src/shared/reportSchema'
import { CAPTURED_CHECKS_RUNNING } from './helpers/githubCapture'
import { networkRig, recordingTransport } from './helpers/reportKindNetwork'

const HEAD_SHA = 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5'

function services(options?: {
  noteGithubCi?: (outcome: { readonly runs: number } | { readonly failed: true }) => void
  transport?: ReportNetworkTransport
  network?: boolean
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'm116-engine-ci-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const bodies: (readonly [string, unknown])[] = [
    ['/pulls?', []],
    ['/check-runs?', CAPTURED_CHECKS_RUNNING],
  ]
  const lane = recordingTransport(
    options?.transport ??
      ((request) => {
        for (const [fragment, body] of bodies) {
          if (request.url.includes(fragment)) return Promise.resolve(Response.json(body))
        }
        return Promise.reject(new Error(`unexpected github request ${request.url}`))
      }),
  )
  const rig = networkRig({ transport: lane.transport })
  return createReportingServices({
    workspaceRoot: root,
    storageRoot: path.join(root, 'reports'),
    l10n: { table: EN, locale: 'en' },
    generatorVersion: 'test',
    keepHistory: false,
    enabledAgents: [],
    ...(options?.network !== false && {
      networkSources: {
        github: githubReportSource({
          remote: 'https://github.com/RandyNorthrup/muse-spark-code.git',
          headSha: HEAD_SHA,
          defaultBranch: 'main',
          reader: rig.reader,
        }),
        stores: storesReportSource({
          reader: rig.reader,
          project: { name: 'muse-spark-code' },
          releaseVersion: '0.19.0',
          adapters: [],
        }),
      },
    }),
    ...(options?.noteGithubCi !== undefined && { noteGithubCi: options.noteGithubCi }),
  })
}

const quality: ReportOptions = {
  kind: 'quality',
  scope: 'fixture',
  full: false,
  network: false,
  failOn: [],
  asOf: '2026-10-21T00:00:00.000Z',
}

describe('report engine CI observation', () => {
  it('reports the observed CI check runs after the github read', async () => {
    const seen: unknown[] = []
    const engine = services({
      noteGithubCi: (outcome) => {
        seen.push(outcome)
      },
    })
    const result = await engine.generate?.(quality)
    expect(result?.status).toBe('generated')
    // The capture's six runs, read once for the head and once for the branch.
    expect(seen).toEqual([{ runs: 12 }])
  })

  it('reports a failed read as failed, never as zero runs', async () => {
    const seen: unknown[] = []
    const engine = services({
      noteGithubCi: (outcome) => {
        seen.push(outcome)
      },
      transport: () => Promise.reject(new TypeError('fetch failed')),
    })
    const result = await engine.generate?.(quality)
    expect(result?.status).toBe('generated')
    expect(seen).toEqual([{ failed: true }])
  })

  it('calls nothing when no generation attempted the github read', async () => {
    const seen: unknown[] = []
    const engine = services({
      noteGithubCi: (outcome) => {
        seen.push(outcome)
      },
      network: false,
    })
    const result = await engine.generate?.(quality)
    expect(result?.status).toBe('generated')
    expect(seen).toEqual([])
  })
})

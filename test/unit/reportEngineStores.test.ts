// Workspace identity is read on every networked report, never latched
// (RVCM1136 P2): a version bump or a newly declared manifest shows up on the
// next refresh of the long-lived editor engine.
//
// The network bundle loads from `dist/`, so the loader seam is mocked at the
// module boundary; the mock records the project each binding receives and
// returns honestly unavailable network ports. The manifest read stays real
// (the report's confined reader over a scratch package.json).
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { createReportingServices } from '../../src/runtime/reporting/engine'
import type { ReportStoreProject } from '../../src/core/reporting/sources/storeProject'
import { REPORT_AS_OF } from './helpers/reporting/runtime'

vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureCommand(await original())
})

function unavailableNetworkPort(id: 'github' | 'stores') {
  return {
    kind: id,
    id,
    read: () =>
      Promise.resolve({
        record: {
          id,
          status: 'unavailable',
          reason: 'unbound',
          observedAt: null,
          freshness: { state: 'unknown', ageMs: null },
        },
        data: null,
      }),
  }
}

const rig = vi.hoisted(() => {
  const projects: (ReportStoreProject | undefined)[] = []
  function bundle() {
    return {
      createReportingNetwork(_context: unknown, _git: unknown, project?: ReportStoreProject) {
        projects.push(project)
        return {
          github: unavailableNetworkPort('github'),
          stores: unavailableNetworkPort('stores'),
        }
      },
    }
  }
  return { projects, loader: () => bundle }
})
vi.mock('../../src/runtime/reporting/networkLoader', () => ({
  reportingNetworkLoader: rig.loader,
}))

const roots: string[] = []
afterEach(async () => {
  rig.projects.length = 0
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function servicesFor(root: string) {
  return createReportingServices({
    workspaceRoot: root,
    storageRoot: path.join(root, 'data'),
    l10n: { table: EN, locale: 'en' },
    generatorVersion: '0.0.0-test',
    keepHistory: false,
    enabledAgents: [],
    network: {
      policy: {
        surface: 'editor',
        mode: 'always',
        githubSignedIn: false,
        allowEgress: () => Promise.resolve(true),
      },
      transport: () => Promise.reject(new Error('refused')),
    },
  })
}

const options = {
  kind: 'project' as const,
  asOf: REPORT_AS_OF,
  scope: '',
  full: false,
  network: false,
  failOn: [],
}

/** One manifest generation through the production binding, asserting it ran. */
async function generateWith(root: string, manifest: unknown) {
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest))
  const services = servicesFor(root)
  const generate = services.generate
  if (generate === undefined) throw new Error('Expected a generate port')
  const result = await generate(options)
  expect(result.status).toBe('generated')
  return result
}

describe('report engine workspace identity', () => {
  it('re-reads the manifest on every networked report', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'report-engine-identity-'))
    roots.push(root)
    await generateWith(root, { name: 'fixture-pkg', version: '1.0.0' })
    expect(rig.projects).toHaveLength(1)
    expect(rig.projects[0]).toMatchObject({ name: 'fixture-pkg', releaseVersion: '1.0.0' })
    await generateWith(root, { name: 'fixture-pkg', version: '1.1.0' })
    expect(rig.projects).toHaveLength(2)
    expect(rig.projects[1]).toMatchObject({ name: 'fixture-pkg', releaseVersion: '1.1.0' })
  })

  it('binds stores after the manifest gains identity mid-window', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'report-engine-identity-'))
    roots.push(root)
    await generateWith(root, { scripts: {} })
    expect(rig.projects).toEqual([undefined])
    await generateWith(root, { name: 'fixture-pkg', version: '1.0.0' })
    expect(rig.projects).toHaveLength(2)
    expect(rig.projects[1]).toMatchObject({ name: 'fixture-pkg', releaseVersion: '1.0.0' })
  })
})

// Workspace project binding for the stores source (M113 lane C-M113-6): the
// manifest parser, the network binding with and without a project, and the
// engine path from a workspace package.json to a live npm channel row.
//
// The registry bytes below reuse M97 lane R's verbatim capture shape
// (`version` read from a version document); only the version string differs,
// so no wire field is guessed.
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import {
  readStoreProject,
  reportStoreProject,
  type ReportStoreProject,
} from '../../src/core/reporting/sources/storeProject'
import { createReportingNetwork } from '../../src/runtime/reporting/network'
import { networkContext } from './helpers/reportNetwork'

// Report storage's own-process identity probe runs directly, as in
// reportEngine.test.ts.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureCommand(await original())
})

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function scratch(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'report-store-project-'))
  roots.push(root)
  return root
}

const project: ReportStoreProject = {
  name: 'fixture-pkg',
  publisher: 'fixture',
  engines: { vscode: '^1.99.0' },
  private: false,
  releaseVersion: '0.14.2',
}

describe('reportStoreProject', () => {
  it('reads a full extension manifest', () => {
    expect(
      reportStoreProject({
        name: 'fixture-pkg',
        version: '0.14.2',
        publisher: 'fixture',
        engines: { vscode: '^1.99.0' },
        private: false,
        scripts: {},
      }),
    ).toEqual(project)
  })

  it('reads a name and version alone as an npm-only project', () => {
    expect(reportStoreProject({ name: 'fixture-pkg', version: '0.14.2' })).toEqual({
      name: 'fixture-pkg',
      releaseVersion: '0.14.2',
    })
  })

  it.each([
    undefined,
    null,
    42,
    'fixture-pkg',
    [],
    { name: '', version: '0.14.2' },
    {
      name: 'fixture-pkg',
    },
    { name: 'fixture-pkg', version: '' },
    { name: 'fixture-pkg', version: 14 },
  ])('leaves %p unbound instead of guessing', (manifest) => {
    expect(reportStoreProject(manifest)).toBeUndefined()
  })
})

describe('reporting network store binding', () => {
  it('reads the npm channel live with a project, honestly missing the rest', async () => {
    const root = await scratch()
    const seen: string[] = []
    const bound = createReportingNetwork(
      {
        workspaceRoot: root,
        storageRoot: path.join(root, 'data'),
        l10n: { table: EN, locale: 'en' },
        policy: {
          surface: 'editor',
          mode: 'always',
          githubSignedIn: false,
          allowEgress: () => Promise.resolve(true),
        },
        transport: (request) => {
          seen.push(request.url)
          return Promise.resolve(Response.json({ version: '0.14.1', url: request.url }))
        },
      },
      null,
      project,
    )
    const result = await bound.stores.read(networkContext())
    expect(result.record.status).toBe('partial')
    expect(result.data?.map((row) => [row.channel, row.status, row.version])).toEqual([
      ['Marketplace', 'unavailable', null],
      ['Open VSX', 'unavailable', null],
      ['npm', 'lagging', '0.14.1'],
    ])
    expect(seen).toEqual(['https://registry.npmjs.org/fixture-pkg/latest'])
  })

  it('stays unbound without a project, exactly as before', async () => {
    const root = await scratch()
    const transport = vi.fn((_request: { url: string }) =>
      Promise.resolve(Response.json({ version: '0.14.1', url: '' })),
    )
    const bound = createReportingNetwork(
      {
        workspaceRoot: root,
        storageRoot: path.join(root, 'data'),
        l10n: { table: EN, locale: 'en' },
        policy: {
          surface: 'editor',
          mode: 'always',
          githubSignedIn: false,
          allowEgress: () => Promise.resolve(true),
        },
        transport,
      },
      null,
    )
    const result = await bound.stores.read(networkContext())
    expect(result.record.status).toBe('unavailable')
    expect(result.data).toBeNull()
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('readStoreProject', () => {
  it('parses a declared manifest', async () => {
    await expect(
      readStoreProject(() =>
        Promise.resolve(
          JSON.stringify({ name: 'fixture-pkg', version: '0.14.2', publisher: 'fixture' }),
        ),
      ),
    ).resolves.toEqual({ name: 'fixture-pkg', publisher: 'fixture', releaseVersion: '0.14.2' })
  })

  it.each([
    ['a missing file', () => Promise.reject(new Error('missing'))],
    ['an unparsable file', () => Promise.resolve('not json {')],
    ['a manifest without identity', () => Promise.resolve(JSON.stringify({ scripts: {} }))],
  ])('leaves stores unbound on %s', async (_case, read) => {
    await expect(readStoreProject(read)).resolves.toBeUndefined()
  })
})

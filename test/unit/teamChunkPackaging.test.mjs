import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  deferredCohort,
  sharedModelApiBoundaries,
  sharedResourceAdmission,
  sharedUiText,
  sharedValidation,
  sharedWire,
} from '../../scripts/lib/deferredBundles.mjs'
import { ACP_BUNDLES } from '../../scripts/lib/acpBundles.mjs'

// An installed VS Code must load every chunk its team code can load, and the
// ACP package must carry nothing no shipped entry can reach. Both package
// lists are compared against the reachability the production build's own
// metafile reports, in both directions: no hand-kept chunk lists.
const TEAM_ENTRIES = {
  'dist/team.js': 'src/core/team/teamEntry.ts',
  'dist/teamRunners.js': 'src/host/runners/teamRunnersEntry.ts',
  'dist/teamHost.js': 'src/host/team/teamHostEntry.ts',
  'dist/teamPanel.js': 'src/core/team/teamPanelEntry.ts',
  'dist/teamScheduler.js': 'src/core/team/teamSchedulerEntry.ts',
  'dist/teamWorkerOps.js': 'src/core/team/workers/workerOpsEntry.ts',
  'dist/teamEngine.js': 'src/host/team/teamEngineEntry.ts',
}
// The VSIX and the ACP package ship these team entries; their lazy chunks
// must follow from reachability, never from a list kept here.
const VSIX_TEAM_ENTRIES = [
  'dist/team.js',
  'dist/teamRunners.js',
  'dist/teamHost.js',
  'dist/teamPanel.js',
  'dist/teamScheduler.js',
]
const ACP_TEAM_ENTRIES = ['dist/team.js', 'dist/teamRunners.js', 'dist/teamScheduler.js']
// Six separate production-shaped builds, once: each entry on its own, so a
// shared chunk cannot hide which entry loads it.
const BUILD_TIMEOUT_MS = 60_000

const state = { reachable: new Map() }

function vsixShipped() {
  return new Set(
    readFileSync('.vscodeignore', 'utf8')
      .split('\n')
      .map((line) => line.trim().replaceAll('\\', '/'))
      .filter((line) => line.startsWith('!dist/') && line.endsWith('.js'))
      .map((line) => line.slice(1)),
  )
}

function acpShipped() {
  return new Set(ACP_BUNDLES.filter((name) => name.endsWith('.js')).map((name) => `dist/${name}`))
}

function closure(entries, reachable) {
  const seen = new Set()
  const pending = entries.flatMap((entry) => reachable.get(entry) ?? [])
  while (pending.length > 0) {
    const chunk = pending.pop()
    if (chunk === undefined || seen.has(chunk)) continue
    seen.add(chunk)
    const edges = reachable.get(chunk) ?? []
    for (const next of edges) pending.push(next)
  }
  return seen
}

beforeAll(async () => {
  const plugins = [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedModelApiBoundaries,
  ]
  for (const [output, entry] of Object.entries(TEAM_ENTRIES)) {
    const result = await build({
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.18',
      logLevel: 'silent',
      write: false,
      metafile: true,
      outfile: output,
      entryPoints: [entry],
      plugins,
    })
    const imports = result.metafile.outputs[output]?.imports ?? []
    state.reachable.set(
      output,
      imports
        .filter((named) => named.path.startsWith('./') && named.path.endsWith('.js'))
        .map((named) => `dist/${named.path.slice(2)}`),
    )
  }
}, BUILD_TIMEOUT_MS) // Four production-shaped team builds, once, outside assertions.

describe('team chunk packaging by construction', () => {
  it('ships every chunk the VSIX team entries can reach', () => {
    const shipped = vsixShipped()
    for (const entry of VSIX_TEAM_ENTRIES) {
      for (const chunk of closure([entry], state.reachable))
        expect(shipped.has(chunk), `${entry} reaches ${chunk}`).toBe(true)
    }
  })
  it('ships no team chunk the VSIX team entries cannot reach', () => {
    const shipped = vsixShipped()
    const reachable = closure(VSIX_TEAM_ENTRIES, state.reachable)
    for (const file of shipped) {
      if (/^dist\/team.*\.js$/.test(file) && !VSIX_TEAM_ENTRIES.includes(file))
        expect(reachable.has(file), `${file} is shipped but unreachable`).toBe(true)
    }
  })
  it('ships every chunk the ACP team entries can reach', () => {
    const shipped = acpShipped()
    for (const entry of ACP_TEAM_ENTRIES) {
      for (const chunk of closure([entry], state.reachable))
        expect(shipped.has(chunk), `${entry} reaches ${chunk}`).toBe(true)
    }
  })
  it('ships no team chunk the ACP team entries cannot reach', () => {
    const shipped = acpShipped()
    const reachable = closure(ACP_TEAM_ENTRIES, state.reachable)
    for (const file of shipped) {
      if (/^dist\/team.*\.js$/.test(file) && !ACP_TEAM_ENTRIES.includes(file))
        expect(reachable.has(file), `${file} is shipped but unreachable`).toBe(true)
    }
  })
  it('loads the create, file-IO, sweep and merge chunks from the team host', () => {
    const reachable = closure(['dist/teamHost.js'], state.reachable)
    expect([...reachable].toSorted((left, right) => left.localeCompare(right, 'en'))).toEqual(
      expect.arrayContaining([
        'dist/teamCreate.js',
        'dist/teamFileIo.js',
        'dist/teamWorkerOps.js',
        'dist/teamMerge.js',
      ]),
    )
  })
})

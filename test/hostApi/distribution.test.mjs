import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildEnvironment,
  distributionSchema,
  HOSTS,
  hostManifest,
  inside,
} from '../../scripts/package-hosts/manifest.mjs'
import { packageHost } from '../../scripts/package-hosts/package.mjs'
import { fakeReport } from './fakeHost.mjs'
import { contract, runConformance, validateReport } from './run.mjs'
import { hostMatrix } from '../../scripts/package-hosts/ci.mjs'

const fixture = { root: '' }
const manifest = {
  mhp: '1.x',
  build: [{ command: 'native-build', args: ['--test'] }],
  conformance: { command: 'native-harness', args: [] },
  artifacts: ['artifact.zip'],
}
function host() {
  const directory = path.join(fixture.root, 'hosts', 'jetbrains')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'distribution.json'), JSON.stringify(manifest))
  return directory
}
beforeEach(() => {
  fixture.root = mkdtempSync(path.join(os.tmpdir(), 'm104-i-'))
})
afterEach(() => {
  rmSync(fixture.root, { recursive: true, force: true })
})

describe('native distribution guards', () => {
  it('selects one changed host on PRs and all hosts for shared changes or weekly runs', () => {
    expect(hostMatrix(['hosts/eclipse/pom.xml']).include.map((item) => item.host)).toEqual([
      'eclipse',
    ])
    expect(hostMatrix(['src/shared/hostApi/panel.ts']).include).toHaveLength(9)
    expect(hostMatrix().include).toHaveLength(9)
    expect(hostMatrix([]).include).toEqual([])
  })
  it('names every absent host and never executes a child', () => {
    const run = vi.fn()
    for (const name of Object.keys(HOSTS)) {
      expect(packageHost(fixture.root, name, run)).toEqual({
        host: name,
        outcome: 'skipped-host-absent',
        reason: `hosts/${name} is absent`,
      })
    }
    expect(runConformance(fixture.root, undefined, run)).toHaveLength(9)
    expect(run).not.toHaveBeenCalled()
  })
  it('fails an existing host without its integration manifest', () => {
    const directory = host()
    rmSync(path.join(directory, 'distribution.json'))
    expect(() => hostManifest(fixture.root, 'jetbrains')).toThrow()
  })
  it('refuses a host path that is a file rather than an adapter folder', () => {
    mkdirSync(path.join(fixture.root, 'hosts'))
    writeFileSync(path.join(fixture.root, 'hosts', 'jetbrains'), 'not a folder')
    expect(() => hostManifest(fixture.root, 'jetbrains')).toThrow('MHP_HOST_NOT_DIRECTORY')
  })
  it('fails a broken host symlink instead of reporting an absent-folder skip', () => {
    mkdirSync(path.join(fixture.root, 'hosts'))
    symlinkSync(
      path.join(fixture.root, 'missing-adapter'),
      path.join(fixture.root, 'hosts', 'jetbrains'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(() => hostManifest(fixture.root, 'jetbrains')).toThrow()
  })
  it('rejects unknown hosts, unsafe artifact paths and incompatible protocols', () => {
    expect(() => hostManifest(fixture.root, 'typo')).toThrow('MHP_UNKNOWN_HOST')
    for (const artifacts of [['../escape.zip'], ['/absolute.zip'], [String.raw`C:\escape.zip`], []])
      expect(distributionSchema.safeParse({ ...manifest, artifacts }).success).toBe(false)
    expect(distributionSchema.safeParse({ ...manifest, mhp: '2.x' }).success).toBe(false)
    expect(distributionSchema.safeParse({ ...manifest, build: [] }).success).toBe(false)
    expect(distributionSchema.safeParse({ ...manifest, extra: true }).success).toBe(false)
  })
  it('refuses a symlink outside the host tree', () => {
    const directory = host()
    const outside = path.join(fixture.root, 'outside')
    mkdirSync(outside)
    symlinkSync(
      outside,
      path.join(directory, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(() => inside(directory, 'link')).toThrow('MHP_HOST_PATH_ESCAPE')
  })
  it('removes credentials and child injection variables, preserving ordinary environment', () => {
    const env = {
      PATH: 'path',
      LANG: 'C',
      META_API_KEY: 'fixture',
      GH_TOKEN: 'fixture',
      TOKEN: 'fixture',
      JETBRAINS_PRIVATE_KEY: 'fixture',
      VSCE_PAT: 'fixture',
      OVSX_PAT: 'fixture',
      GOOGLE_APPLICATION_CREDENTIALS: 'fixture',
      NODE_OPTIONS: 'fixture',
      SSH_AUTH_SOCK: 'fixture',
    }
    expect(buildEnvironment(env)).toEqual({ PATH: 'path', LANG: 'C' })
  })
  it('stages runtime bytes and records exact artifact hashes and source tree', () => {
    const directory = host()
    const runtime = path.join(fixture.root, 'dist', 'acp-package')
    mkdirSync(path.join(runtime, 'dist'), { recursive: true })
    for (const name of ['dist/acp.js', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'])
      writeFileSync(path.join(runtime, name), 'fixture runtime')
    writeFileSync(path.join(fixture.root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    const run = vi.fn((command) => {
      if (command === 'git') return `${'a'.repeat(40)}\n`
      writeFileSync(path.join(directory, 'artifact.zip'), 'archive')
      return ''
    })
    const receipt = packageHost(fixture.root, 'jetbrains', run)
    expect(receipt).toMatchObject({
      outcome: 'packaged',
      version: '1.2.3',
      tree: 'a'.repeat(40),
      mhp: '1.x',
    })
    expect(Object.values(receipt.sha256)[0]).toMatch(/^[a-f0-9]{64}$/u)
    expect(
      readFileSync(
        path.join(fixture.root, 'dist', 'hosts', 'jetbrains', 'runtime', 'dist', 'acp.js'),
        'utf8',
      ),
    ).toBe('fixture runtime')
    expect(run.mock.calls[0][2].env.MUSE_MHP_VERSION).toBe('mhp/1.1.0')
    const stale = path.join(fixture.root, 'dist', 'hosts', 'jetbrains', 'muse-spark-code-old.zip')
    writeFileSync(stale, 'obsolete build')
    packageHost(fixture.root, 'jetbrains', run)
    expect(existsSync(stale)).toBe(false)
    writeFileSync(path.join(directory, 'artifact.zip'), '')
    expect(() =>
      packageHost(
        fixture.root,
        'jetbrains',
        vi.fn(() => ''),
      ),
    ).toThrow('MHP_HOST_EMPTY_ARTIFACT')
  })
  it('refuses an incomplete runtime before invoking any native command', () => {
    host()
    const run = vi.fn()
    expect(() => packageHost(fixture.root, 'jetbrains', run)).toThrow()
    expect(run).not.toHaveBeenCalled()
  })
  it('refuses a runtime entry that is a directory before invoking a native command', () => {
    host()
    const runtime = path.join(fixture.root, 'dist', 'acp-package')
    mkdirSync(path.join(runtime, 'dist', 'acp.js'), { recursive: true })
    for (const name of ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'])
      writeFileSync(path.join(runtime, name), 'fixture runtime')
    const run = vi.fn()
    expect(() => packageHost(fixture.root, 'jetbrains', run)).toThrow('MHP_HOST_RUNTIME_INCOMPLETE')
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects duplicate output names from two native artifacts', () => {
    const directory = host()
    writeFileSync(
      path.join(directory, 'distribution.json'),
      JSON.stringify({ ...manifest, artifacts: ['artifact.zip', 'nested/artifact.zip'] }),
    )
    mkdirSync(path.join(directory, 'nested'))
    writeFileSync(path.join(directory, 'artifact.zip'), 'archive')
    writeFileSync(path.join(directory, 'nested', 'artifact.zip'), 'other archive')
    const runtime = path.join(fixture.root, 'dist', 'acp-package')
    mkdirSync(path.join(runtime, 'dist'), { recursive: true })
    for (const name of ['dist/acp.js', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'])
      writeFileSync(path.join(runtime, name), 'fixture runtime')
    writeFileSync(path.join(fixture.root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    expect(() => packageHost(fixture.root, 'jetbrains', () => '')).toThrow(
      'MHP_HOST_DUPLICATE_ARTIFACT',
    )
  })
})

describe('MHP 1.1 every-host conformance runner', () => {
  it('executes every shared scenario against both fake backends', () => {
    expect(validateReport('jetbrains', fakeReport()).results).toHaveLength(
      contract.scenarios.length * 2,
    )
  })
  it('runs the existing host harness with the full contract and checks its observations', () => {
    host()
    const run = vi.fn(() => JSON.stringify(fakeReport()))
    expect(
      runConformance(fixture.root, undefined, run).filter((item) => item.outcome === 'conformant'),
    ).toHaveLength(1)
    expect(JSON.parse(run.mock.calls[0][2].input)).toEqual(contract)
    expect(run.mock.calls[0][0]).toBe('native-harness')
  })
  it('requires the harness of every existing host, rather than stopping after the first', () => {
    for (const name of Object.keys(HOSTS)) {
      const directory = path.join(fixture.root, 'hosts', name)
      mkdirSync(directory, { recursive: true })
      writeFileSync(path.join(directory, 'distribution.json'), JSON.stringify(manifest))
    }
    const run = vi.fn((_command, _args, options) =>
      JSON.stringify(fakeReport(path.basename(options.cwd))),
    )
    expect(runConformance(fixture.root, undefined, run)).toHaveLength(9)
    expect(run).toHaveBeenCalledTimes(9)
  })
  it('rejects zero tests, duplicates, skips, wrong host and wrong protocol', () => {
    for (const mutate of [
      (report) => {
        report.results = []
      },
      (report) => {
        report.results[1] = report.results[0]
      },
      (report) => {
        report.results[0].skipped = true
      },
      (report) => {
        report.host = 'eclipse'
      },
      (report) => {
        report.protocol = 'mhp/1.0.0'
      },
      (report) => {
        report.extra = true
      },
    ]) {
      const report = fakeReport()
      mutate(report)
      expect(() => validateReport('jetbrains', report)).toThrow()
    }
  })
  it('rejects extra results even if all required scenarios are present', () => {
    const report = fakeReport()
    report.results.push({ ...report.results[0], scenario: 'extra' })
    expect(() => validateReport('jetbrains', report)).toThrow('MHP_CONFORMANCE_COUNT')
  })
  it('reports duplicate scenario identities with the explicit correlation error', () => {
    const report = fakeReport()
    report.results[1] = report.results[0]
    expect(() => validateReport('jetbrains', report)).toThrow(
      'MHP_CONFORMANCE_MISSING_OR_DUPLICATE',
    )
  })
  it.each(contract.scenarios.map((scenario) => scenario.id))(
    'rejects incorrect %s behavior',
    (scenario) => {
      const report = fakeReport()
      const result = report.results.find((item) => item.scenario === scenario)
      result.observations = {}
      expect(() => validateReport('jetbrains', report)).toThrow('MHP_CONFORMANCE_OBSERVATION')
    },
  )
  it('propagates harness errors and rejects malformed output', () => {
    host()
    expect(() =>
      runConformance(fixture.root, ['jetbrains'], () => {
        throw new Error('native-test-failed')
      }),
    ).toThrow('native-test-failed')
    expect(() => runConformance(fixture.root, ['jetbrains'], () => '{}')).toThrow()
  })
})

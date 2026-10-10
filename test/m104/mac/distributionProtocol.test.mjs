import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MHP } from '../../../src/shared/constants.ts'
import { distributionSchema } from '../../../scripts/package-hosts/manifest.mjs'
import { hostMatrix } from '../../../scripts/package-hosts/ci.mjs'
import { validateReport } from '../../hostApi/run.mjs'
import { fakeReport } from '../../hostApi/fakeHost.mjs'

const snapshot = JSON.parse(
  readFileSync(new URL('../../../src/shared/hostApi/mhp-v1.schema.json', import.meta.url), 'utf8'),
)
const manifest = {
  mhp: MHP.version,
  build: [{ command: 'fake-build', args: [] }],
  conformance: { command: 'fake-harness', args: [] },
  artifacts: ['fake.zip'],
}

describe('parity distribution uses the adopted contract', () => {
  it('accepts the current shared version and refuses superseded and future versions', () => {
    expect(snapshot.protocol).toBe(MHP.version)
    expect(distributionSchema.safeParse(manifest).success).toBe(true)
    const [major, minor, patch] = MHP.version.split('.', 3)
    const superseded = Array.from(
      { length: Number(minor) },
      (_, version) => `${major}.${version}.${patch}`,
    )
    for (const mhp of ['1.x', ...superseded, MHP.maximumVersionExclusive])
      expect(distributionSchema.safeParse({ ...manifest, mhp }).success).toBe(false)
  })
  it('requires the observed harness protocol to match the runtime snapshot', () => {
    const report = fakeReport('xcode')
    expect(report.protocol).toBe(MHP.version)
    expect(validateReport('xcode', report).protocol).toBe(MHP.version)
    expect(() =>
      validateReport('xcode', { ...report, protocol: MHP.maximumVersionExclusive }),
    ).toThrow()
  })
  it('selects Xcode alone with either Windows or POSIX source paths', () => {
    for (const file of [
      'hosts/xcode/App/PanelModel.swift',
      String.raw`hosts\xcode\App\PanelModel.swift`,
    ])
      expect(hostMatrix([file]).include.map(({ host }) => host)).toEqual(['xcode'])
  })
})

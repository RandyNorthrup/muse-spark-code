import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { distributionSchema } from '../../../scripts/package-hosts/manifest.mjs'
import { hostMatrix } from '../../../scripts/package-hosts/ci.mjs'
import { validateReport } from '../../hostApi/run.mjs'
import { fakeReport } from '../../hostApi/fakeHost.mjs'

const snapshot = JSON.parse(
  readFileSync(new URL('../../../src/shared/hostApi/mhp-v1.schema.json', import.meta.url), 'utf8'),
)
const manifest = {
  mhp: snapshot.protocol,
  build: [{ command: 'fake-build', args: [] }],
  conformance: { command: 'fake-harness', args: [] },
  artifacts: ['fake.zip'],
}

describe('parity distribution uses the adopted contract', () => {
  it('accepts exactly the reviewed native snapshot version and refuses every old promise', () => {
    expect(distributionSchema.safeParse(manifest).success).toBe(true)
    for (const mhp of ['1.x', 'mhp/1.0.0', 'mhp/1.1.0', 'mhp/1.2.0', 'mhp/1.4.0'])
      expect(distributionSchema.safeParse({ ...manifest, mhp }).success).toBe(false)
  })
  it('requires the observed harness protocol to match the runtime snapshot', () => {
    const report = fakeReport('xcode')
    expect(report.protocol).toBe(snapshot.protocol)
    expect(validateReport('xcode', report).protocol).toBe(snapshot.protocol)
    expect(() => validateReport('xcode', { ...report, protocol: 'mhp/1.1.0' })).toThrow()
  })
  it('selects Xcode alone with either Windows or POSIX source paths', () => {
    for (const file of [
      'hosts/xcode/App/PanelModel.swift',
      String.raw`hosts\xcode\App\PanelModel.swift`,
    ])
      expect(hostMatrix([file]).include.map(({ host }) => host)).toEqual(['xcode'])
  })
})

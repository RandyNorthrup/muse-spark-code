import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOSTS } from '../../scripts/package-hosts/manifest.mjs'

const native = () =>
  readFileSync(new URL('../../.github/workflows/hosts-native.yml', import.meta.url), 'utf8')
const release = () =>
  readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
function job(source, id) {
  const match = source.match(
    new RegExp(String.raw`^ {2}${id}:\n([\s\S]*?)(?=^ {2}[\w-]+:|$(?![\s\S]))`, 'mu'),
  )
  expect(match, `missing job ${id}`).not.toBeNull()
  return match[1]
}
describe('native workflow release fences', () => {
  it('attaches verified native bytes before checksums, attestation and publication', () => {
    const block = job(release(), 'release')
    expect(block).toContain('needs: [verify, reuse, build, native-sign]')
    expect(block).toContain("needs.native-sign.result == 'success'")
    expect(block).toContain('pattern: m104-native-release-*')
    expect(block).toContain('merge-multiple: false')
    const stage = 'node scripts/package-hosts/release.mjs stage native-release release'
    expect(block).toContain(stage)
    expect(block.indexOf(stage)).toBeLessThan(block.indexOf('sha256sum'))
    expect(block).toContain('mapfile -t native < .native')
    expect(block).toContain('"${native[@]/#/./}" > SHA256SUMS')
    expect(block).toContain('subject-checksums: release/SHA256SUMS')
    expect(block).toContain('mapfile -t native < release/.native')
    expect(block).toContain('"${native[@]/#/release/}" release/SHA256SUMS')
    expect(block.indexOf('sha256sum')).toBeLessThan(
      block.indexOf('node scripts/github-release.mjs'),
    )
  })
  it('runs shared conformance and packages each discovered host without credentials', () => {
    const source = native()
    expect(source).toContain('pull_request:')
    expect(source).toContain("- 'hosts/**'")
    expect(source).toContain('schedule:')
    expect(source).toContain('workflow_call:')
    expect(source).toContain('contents: read')
    expect(source).not.toContain('secrets.')
    expect(job(source, 'host')).toContain('node test/hostApi/run.mjs "$HOST_ID"')
    expect(job(source, 'host')).toContain('node scripts/package-hosts/package.mjs "$HOST_ID"')
    expect(job(source, 'host')).toContain('skipped-host-absent: hosts/$HOST_ID is absent')
    expect(job(source, 'host')).toContain('if-no-files-found: error')
    expect(job(source, 'contract')).toContain('node scripts/mhp-schema.mjs --check')
  })
  it('keeps every native channel behind the existing release environment', () => {
    const source = release()
    expect(job(source, 'native-build')).toContain('uses: ./.github/workflows/hosts-native.yml')
    expect(job(source, 'native-build')).not.toContain('secrets')
    for (const id of ['native-sign', 'native-publish']) {
      const block = job(source, id)
      expect(block).toContain('environment: marketplace')
      expect(block).toContain('contents: read')
      expect(block).not.toContain('contents: write')
      for (const host of Object.keys(HOSTS)) expect(block).toContain(`host: ${host},`)
      expect(block).toContain('skipped-host-absent: hosts/$HOST_ID is absent')
      expect(block).toContain('npm ci --ignore-scripts --no-audit')
    }
    expect(job(source, 'native-publish')).toContain('needs: [release, native-sign]')
    expect(job(source, 'native-sign')).toContain('never during recovery')
    expect(job(source, 'native-sign')).toContain("github.event_name == 'push'")
    expect(job(source, 'native-publish')).toContain('MUSE_HOST_OUTCOME_FILE:')
    expect(job(source, 'native-publish')).toContain(
      'node scripts/package-hosts/release.mjs github "$HOST_ID" native-package',
    )
  })
})

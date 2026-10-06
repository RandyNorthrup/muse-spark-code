import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = () => readFileSync('.github/workflows/node-image.yml', 'utf8')
const job = (name) =>
  workflow()
    .split(`\n  ${name}:\n`, 2)[1]
    ?.split(/\n {2}\w+:\n/, 1)[0] ?? ''

describe('node image release admission', () => {
  it('requires successful native checks before tag-only product builds', () => {
    expect(job('build')).toContain('needs: checks')
    expect(job('build')).toContain(
      "if: github.ref_type == 'tag' && startsWith(github.ref_name, 'v')",
    )
    expect(job('build')).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main')
    for (const runner of ['ubuntu-24.04', 'ubuntu-24.04-arm']) {
      expect(job('checks')).toContain(`runner: ${runner}`)
      expect(job('build')).toContain(`runner: ${runner}`)
    }
    expect(job('checks')).toContain('rootless Podman runs the same fixture suite')
    expect(job('build')).not.toContain('m110-private-fixture')
  })
  it('scans original layers and fixable critical vulnerabilities before upload', () => {
    const build = job('build')
    const push = build.indexOf('push only the checked OCI bytes')
    expect(push).toBeGreaterThan(0)
    expect(build.indexOf('node scripts/check-node-image.mjs')).toBeGreaterThan(0)
    expect(build.indexOf('node scripts/check-node-image.mjs')).toBeLessThan(push)
    expect(build.indexOf('--severity CRITICAL --ignore-unfixed --exit-code 1')).toBeGreaterThan(0)
    expect(build.indexOf('--severity CRITICAL --ignore-unfixed --exit-code 1')).toBeLessThan(push)
    expect(build).toContain('--provenance=mode=max')
    expect(build).toContain('--sbom=generator=docker/buildkit-syft-scanner@sha256:')
  })
  it('exposes release tags only after signature and both attestation identities verify', () => {
    const publish = job('publish')
    const promote = publish.indexOf('--tag "$IMAGE:$GITHUB_REF_NAME"')
    expect(promote).toBeGreaterThan(0)
    for (const verification of [
      'verifyReleaseIdentity(process.env.REFERENCE,process.env.GITHUB_REF_NAME)',
      '--type spdxjson "$REFERENCE" >/dev/null',
      '--type slsaprovenance "$REFERENCE" >/dev/null',
    ]) {
      expect(publish.indexOf(verification)).toBeGreaterThan(0)
      expect(publish.indexOf(verification)).toBeLessThan(promote)
    }
    expect(publish).toContain(
      'candidate="$IMAGE:build-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-index"',
    )
    expect(publish).toContain(
      '--certificate-oidc-issuer https://token.actions.githubusercontent.com',
    )
    expect(publish).toContain('test "$promoted" = "$digest"')
  })
  it('caps artifacts and serializes registry retention with unpublished image graphs', () => {
    expect(job('build')).toContain('retention-days: 14')
    expect(job('build')).toContain('path: dist/receipt-${{ matrix.arch }}.json')
    expect(job('build')).not.toContain('path: dist/node-')
    expect(workflow()).toContain('group: muse-node-images\n  cancel-in-progress: false')
    expect(job('retention')).toContain("needs.publish.result == 'success'")
  })
  it('blocks the release major tag when the image job fails', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(release).toContain('needs: [release, publish, openvsx, npm, node-image]')
    expect(release).toContain('NODE_IMAGE_RESULT: ${{ needs.node-image.result }}')
    expect(release).toContain('test "$NODE_IMAGE_RESULT" = success')
    expect(release.indexOf('test "$NODE_IMAGE_RESULT" = success')).toBeLessThan(
      release.indexOf('run: node scripts/release-summary.mjs'),
    )
  })
})

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { nodeImageChannel } from '../../scripts/retain-node-images.mjs'

const workflow = () => readFileSync('.github/workflows/node-image.yml', 'utf8')
const job = (name) =>
  workflow()
    .split(`\n  ${name}:\n`, 2)[1]
    ?.split(/\n {2}\w+:\n/, 1)[0] ?? ''
const image = 'ghcr.io/randynorthrup/muse-spark-code-node'
const currentDigest = `sha256:${'1'.repeat(64)}`
const candidateDigest = `sha256:${'2'.repeat(64)}`
const registryVersion = (id, tags) => ({
  id,
  name: currentDigest,
  created_at: '2026-10-05T00:00:00Z',
  metadata: { container: { tags } },
})
const dockerStubBody = String.raw`import fs from 'node:fs'
const args = process.argv.slice(2)
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, 'utf8'))
if (args[2] === 'inspect') {
  if (process.env.FAKE_DOCKER_UNAVAILABLE === '1') {
    process.stderr.write('registry unavailable\n')
    process.exit(1)
  }
  const tag = args.at(-1).split(':').at(-1)
  if (!state[tag]) {
    if (process.env.FAKE_AMBIGUOUS_INSPECT === '1') {
      process.stderr.write('unexpected status: 401 Unauthorized\n')
    } else {
      process.stderr.write('ERROR: ' + process.env.IMAGE + ':' + tag + ': not found\n')
    }
    process.exit(1)
  }
  process.stdout.write(JSON.stringify({ digest: state[tag] }))
} else if (args[2] === 'create') {
  if (process.env.FAKE_DOCKER_UNAVAILABLE === '1') {
    process.stderr.write('registry unavailable\n')
    process.exit(1)
  }
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--tag') state[args[index + 1].split(':').at(-1)] = args.at(-1).split('@').at(-1)
  }
  fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(state))
} else process.exit(1)
`
const promote = (
  tag,
  current,
  {
    pages,
    registryFailure = false,
    changedDigest = false,
    isDockerUnavailable = false,
    ambiguousInspect = false,
  } = {},
) => {
  mkdirSync('temp', { recursive: true })
  const directory = mkdtempSync(path.resolve('temp/m110-c-channel space &-'))
  const channel = tag.includes('-') ? 'preview' : 'stable'
  const stateFile = path.join(directory, 'state.json')
  const snapshot = path.join(directory, 'snapshot.json')
  const hasCurrent =
    current !== undefined ||
    (pages?.flat().some((entry) => entry.metadata?.container?.tags?.includes(channel)) ?? false)
  writeFileSync(
    stateFile,
    JSON.stringify(
      hasCurrent ? { [channel]: changedDigest ? candidateDigest : currentDigest } : {},
    ),
  )
  writeFileSync(
    snapshot,
    JSON.stringify(pages ?? [current ? [registryVersion(1, [channel, current])] : []]),
  )
  const dockerScript = path.join(directory, 'docker stub.mjs')
  const ghScript = path.join(directory, 'gh.mjs')
  writeFileSync(dockerScript, dockerStubBody)
  writeFileSync(
    ghScript,
    `import fs from 'node:fs'
if (process.env.FAKE_REGISTRY_FAILURE === '1') process.exit(1)
process.stdout.write(fs.readFileSync(process.env.FAKE_SNAPSHOT, 'utf8'))
`,
  )
  const publish = job('publish')
  const guardedStart = publish.indexOf('          gh api --paginate --slurp')
  const start = guardedStart === -1 ? publish.indexOf('          channel=stable') : guardedStart
  expect(start).toBeGreaterThan(0)
  try {
    // Substitute only the executable dependency; keep the workflow's actual
    // promotion shell and the helper's real execFileSync implementation.
    const script = publish
      .slice(start)
      .replaceAll(/^ {10}/gm, '')
      .replace('{file:"docker",args:[]}', 'JSON.parse(process.env.FAKE_DOCKER_COMMAND)')
    expect(script).toContain('JSON.parse(process.env.FAKE_DOCKER_COMMAND)')
    const functions = `
node() { "$FAKE_NODE" "$@"; }
docker() { "$FAKE_NODE" "$FAKE_DOCKER_SCRIPT" "$@"; }
gh() { "$FAKE_NODE" "$FAKE_GH_SCRIPT" "$@"; }
`
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', functions + script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_NODE: process.execPath.replaceAll('\\', '/'),
        FAKE_DOCKER_SCRIPT: dockerScript.replaceAll('\\', '/'),
        FAKE_GH_SCRIPT: ghScript.replaceAll('\\', '/'),
        FAKE_DOCKER_COMMAND: JSON.stringify({ file: process.execPath, args: [dockerScript] }),
        FAKE_STATE: stateFile,
        FAKE_SNAPSHOT: snapshot,
        FAKE_REGISTRY_FAILURE: registryFailure ? '1' : '0',
        FAKE_DOCKER_UNAVAILABLE: isDockerUnavailable ? '1' : '0',
        FAKE_AMBIGUOUS_INSPECT: ambiguousInspect ? '1' : '0',
        IMAGE: image,
        REFERENCE: `${image}@${candidateDigest}`,
        GITHUB_REF_NAME: tag,
        GITHUB_STEP_SUMMARY: path.join(directory, 'summary'),
        RUNNER_TEMP: directory,
        digest: candidateDigest,
      },
    })
    return { result, tags: JSON.parse(readFileSync(stateFile, 'utf8')), channel }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

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
  it.each([
    ['v0.14.0', 'v0.15.0'],
    ['v0.9.0', 'v0.10.0'],
    ['v0.14.0', 'v1.0.0'],
    ['v0.15.0-beta.2', 'v0.15.0-beta.10'],
    ['v0.15.0-alpha', 'v0.15.0-beta'],
    ['v0.15.0-beta', 'v0.15.0-beta.1'],
    ['v0.15.0-9', 'v0.15.0-alpha'],
    ['v0.15.0-beta', 'v0.15.0'],
    ['v0.14.0', 'v0.15.0+build.4'],
    ['v0.9007199254740992.0', 'v0.9007199254740993.0'],
  ])('publishes recovery %s without downgrading the channel from %s', (tag, current) => {
    const { result, tags, channel } = promote(tag, current)
    expect(result.status, result.stderr).toBe(0)
    expect(tags[tag]).toBe(candidateDigest)
    expect(tags[channel]).toBe(currentDigest)
  })
  it.each([
    ['v0.15.0', 'v0.14.0'],
    ['v0.10.0', 'v0.9.0'],
    ['v1.0.0', 'v0.15.0'],
    ['v0.15.0', 'v0.15.0'],
    ['v0.15.0-beta.10', 'v0.15.0-beta.2'],
    ['v0.15.0-beta', 'v0.15.0-alpha'],
    ['v0.15.0-beta.1', 'v0.15.0-beta'],
    ['v0.15.0-alpha', 'v0.15.0-9'],
    ['v0.15.0-beta.1', 'v0.15.0-beta.1'],
    ['v0.15.0', 'v0.15.0-beta'],
    ['v0.15.0', 'v0.15.0+build.4'],
    ['v0.9007199254740993.0', 'v0.9007199254740992.0'],
    ['v0.15.0', undefined],
    ['v0.15.0-beta.1', undefined],
  ])('advances or initializes the channel for %s from %s', (tag, current) => {
    const { result, tags, channel } = promote(tag, current)
    expect(result.status, result.stderr).toBe(0)
    expect(tags[tag]).toBe(candidateDigest)
    expect(tags[channel]).toBe(candidateDigest)
  })
  it('checks every page and every release alias of the current channel', () => {
    const pages = [[], [registryVersion(1, ['stable', 'v0.13.0', 'v0.15.0'])]]
    const { result, tags } = promote('v0.14.0', undefined, { pages })
    expect(result.status, result.stderr).toBe(0)
    expect(tags.stable).toBe(currentDigest)
  })
  it.each([
    { registryFailure: true },
    { isDockerUnavailable: true },
    { pages: [[]] },
    { changedDigest: true },
    { pages: [[registryVersion(1, ['stable'])]] },
    { pages: [[registryVersion(1, ['stable', 'v0.015.0'])]] },
    { pages: [[registryVersion(1, ['stable', 'v0.15.0-beta.01'])]] },
    { pages: [[{ ...registryVersion(1, ['stable', 'v0.15.0']), id: 'invalid' }]] },
    {
      pages: [
        [registryVersion(1, ['stable', 'v0.15.0'])],
        [registryVersion(2, ['stable', 'v0.14.0'])],
      ],
    },
    { pages: [[{ metadata: { container: { tags: ['stable', 'v0.15.0'] } } }]] },
  ])('refuses publication when current channel state is unavailable or invalid: %j', (options) => {
    const { result, tags } = promote('v0.14.0', 'v0.15.0', options)
    expect(result.status, result.stderr).not.toBe(0)
    if (options.registryFailure || options.isDockerUnavailable) {
      // The version write itself never ran: the listing fetch failed, or
      // docker could not create the tag either.
      expect(tags['v0.14.0']).toBeUndefined()
    } else {
      // Only the channel lookup was ambiguous: the verified version tag is
      // still written, the channel is left alone, and the step fails loudly.
      expect(tags['v0.14.0']).toBe(candidateDigest)
      // changedDigest starts with the channel already pointing at the
      // candidate; every other case must leave the channel untouched.
      expect(tags.stable).toBe(options.changedDigest ? candidateDigest : currentDigest)
    }
  })
  it('writes the version tag but refuses the channel when first-time inspection is ambiguous', () => {
    const { result, tags } = promote('v0.15.0-beta.1', undefined, {
      pages: [[]],
      ambiguousInspect: true,
    })
    expect(result.status, result.stderr).not.toBe(0)
    expect(tags['v0.15.0-beta.1']).toBe(candidateDigest)
    expect(tags.preview).toBeUndefined()
  })
  it('refuses every tag write when the candidate is not a release version', () => {
    const { result, tags } = promote('notaversion', 'v0.15.0')
    expect(result.status, result.stderr).not.toBe(0)
    expect(tags.notaversion).toBeUndefined()
    expect(tags.stable).toBe(currentDigest)
  })
  it('passes the configured executable and argument prefix directly without a shell', () => {
    const execute = vi.fn(() => JSON.stringify({ digest: currentDigest }))
    const command = { file: process.execPath, args: ['a path with spaces & symbols.mjs'] }
    expect(
      nodeImageChannel('v0.15.0', [[registryVersion(1, ['stable', 'v0.14.0'])]], command, execute),
    ).toBe('stable')
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      command.file,
      [
        ...command.args,
        'buildx',
        'imagetools',
        'inspect',
        '--format',
        '{{json .Manifest}}',
        `${image}:stable`,
      ],
      { encoding: 'utf8', stdio: 'pipe', shell: false },
    )
  })
  it.each([
    null,
    'docker',
    {},
    { file: '', args: [] },
    { file: 42, args: [] },
    { file: 'docker' },
    { file: 'docker', args: '--version' },
    { file: 'docker', args: [42] },
    { file: 'docker', args: [], shell: true },
  ])('rejects an invalid Docker command before executing: %j', (command) => {
    const execute = vi.fn()
    expect(() => nodeImageChannel('v0.15.0', [[]], command, execute)).toThrow(z.ZodError)
    expect(execute).not.toHaveBeenCalled()
  })
  it('refuses to initialize a channel when registry inspection is unavailable', () => {
    const { result, tags } = promote('v0.14.0', undefined, { isDockerUnavailable: true })
    expect(result.status).not.toBe(0)
    expect(tags['v0.14.0']).toBeUndefined()
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

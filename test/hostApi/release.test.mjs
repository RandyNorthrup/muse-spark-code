import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  publishArtifacts,
  signArtifacts,
  stageArtifacts,
  nativeSummary,
  verifyReleaseAssets,
  verifyArtifacts,
} from '../../scripts/package-hosts/release.mjs'

const fixture = { root: '', assets: '' }
const digest = (value) => createHash('sha256').update(value).digest('hex')
const tree = 'a'.repeat(40)
const run = vi.fn((command) => (command === 'git' ? `${tree}\n` : ''))
function prepare(host = 'jetbrains') {
  const folder = path.join(fixture.root, 'hosts', host)
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    path.join(folder, 'distribution.json'),
    JSON.stringify({
      mhp: 'mhp/1.3.0',
      build: [{ command: 'build', args: [] }],
      conformance: { command: 'harness', args: [] },
      artifacts: ['artifact.zip'],
      sign: { command: 'sign', args: [] },
      publish: { command: 'publish', args: [] },
    }),
  )
  writeFileSync(path.join(fixture.root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  const receipt = {
    host,
    outcome: 'packaged',
    mhp: 'mhp/1.3.0',
    version: '1.2.3',
    tree,
    sha256: { 'artifact.zip': digest('archive') },
    runtimeSha256: { 'dist/acp.js': digest('runtime') },
  }
  writeFileSync(path.join(fixture.assets, 'artifact.zip'), 'archive')
  writeFileSync(path.join(fixture.assets, 'receipt.json'), JSON.stringify(receipt))
  return receipt
}
function receiptChange(change) {
  const receipt = JSON.parse(readFileSync(path.join(fixture.assets, 'receipt.json'), 'utf8'))
  change(receipt)
  writeFileSync(path.join(fixture.assets, 'receipt.json'), JSON.stringify(receipt))
}
function mutatingPublisher(command) {
  if (command === 'git') return tree
  writeFileSync(path.join(fixture.assets, 'artifact.zip'), 'rebuilt')
  return ''
}
function corruptDownload(command, args) {
  if (command === 'git') return tree
  writeFileSync(
    path.join(args[args.indexOf('--dir') + 1], args[args.indexOf('--pattern') + 1]),
    'wrong bytes',
  )
  return ''
}
beforeEach(() => {
  fixture.root = mkdtempSync(path.join(os.tmpdir(), 'm104-i-release-'))
  fixture.assets = path.join(fixture.root, 'assets')
  mkdirSync(fixture.assets)
  run.mockClear()
})
afterEach(() => rmSync(fixture.root, { recursive: true, force: true }))

describe('native release integrity', () => {
  it('accepts scoped runtime dependencies and refuses unsafe paths or invalid hashes', () => {
    prepare()
    receiptChange((receipt) => {
      receipt.runtimeSha256 = { 'node_modules/@napi-rs/keyring/keyring.node': digest('native') }
    })
    expect(verifyArtifacts(fixture.root, fixture.assets, 'jetbrains', run).runtimeSha256).toEqual({
      'node_modules/@napi-rs/keyring/keyring.node': digest('native'),
    })
    run.mockClear()
    for (const [name, hash] of [
      ['../escape', digest('native')],
      ['folder/./file', digest('native')],
      ['/absolute', digest('native')],
      [String.raw`C:\\escape`, digest('native')],
      ['folder//file', digest('native')],
      ['dist/acp.js', 'bad-hash'],
    ]) {
      receiptChange((receipt) => {
        receipt.runtimeSha256 = { [name]: hash }
      })
      expect(() => verifyArtifacts(fixture.root, fixture.assets, 'jetbrains', run)).toThrow()
      expect(run).not.toHaveBeenCalled()
    }
  })
  it('refuses old MHP receipts and absent or empty runtime inventories before a channel command', () => {
    for (const change of [
      (receipt) => {
        receipt.mhp = 'mhp/1.1.0'
      },
      (receipt) => {
        delete receipt.runtimeSha256
      },
      (receipt) => {
        receipt.runtimeSha256 = {}
      },
    ]) {
      prepare()
      receiptChange(change)
      expect(() => signArtifacts(fixture.root, fixture.assets, 'jetbrains', {}, run)).toThrow()
      expect(run).not.toHaveBeenCalled()
    }
  })
  it('verifies exact source tree, version, host, inventory and bytes', () => {
    prepare()
    expect(verifyArtifacts(fixture.root, fixture.assets, 'jetbrains', run).tree).toBe(tree)
  })
  it.each([
    [
      'host',
      (receipt) => {
        receipt.host = 'eclipse'
      },
      'MHP_HOST_RECEIPT_HOST',
    ],
    [
      'version',
      (receipt) => {
        receipt.version = '1.2.4'
      },
      'MHP_HOST_RECEIPT_VERSION',
    ],
    [
      'tree',
      (receipt) => {
        receipt.tree = 'b'.repeat(40)
      },
      'MHP_HOST_RECEIPT_TREE',
    ],
    [
      'empty inventory',
      (receipt) => {
        receipt.sha256 = {}
      },
      'MHP_HOST_RECEIPT_EMPTY',
    ],
    [
      'hash',
      (receipt) => {
        receipt.sha256['artifact.zip'] = 'b'.repeat(64)
      },
      'MHP_HOST_RECEIPT_SHA256',
    ],
    [
      'unsafe path',
      (receipt) => {
        receipt.sha256 = { '../escape': 'b'.repeat(64) }
      },
      undefined,
    ],
    [
      'protocol',
      (receipt) => {
        receipt.mhp = '2.x'
      },
      undefined,
    ],
  ])('rejects a changed %s receipt before signing or publishing', (_name, mutate, error) => {
    prepare()
    receiptChange(mutate)
    expect(() => verifyArtifacts(fixture.root, fixture.assets, 'jetbrains', run)).toThrow(error)
    expect(() => publishArtifacts(fixture.root, fixture.assets, 'jetbrains', {}, run)).toThrow()
  })
  it('rejects additional files, missing assets and empty archives', () => {
    prepare()
    writeFileSync(path.join(fixture.assets, 'extra.zip'), 'unexpected')
    expect(() => verifyArtifacts(fixture.root, fixture.assets, 'jetbrains', run)).toThrow(
      'MHP_HOST_RECEIPT_INVENTORY',
    )
    rmSync(path.join(fixture.assets, 'extra.zip'))
    writeFileSync(path.join(fixture.assets, 'artifact.zip'), '')
    expect(() => verifyArtifacts(fixture.root, fixture.assets, 'jetbrains', run)).toThrow(
      'MHP_HOST_EMPTY_ARTIFACT',
    )
    rmSync(path.join(fixture.assets, 'artifact.zip'))
    expect(() => verifyArtifacts(fixture.root, fixture.assets, 'jetbrains', run)).toThrow(
      'MHP_HOST_RECEIPT_INVENTORY',
    )
  })
  it('names missing signing credentials and local-only Xcode builds without creating credentials', () => {
    prepare()
    expect(signArtifacts(fixture.root, fixture.assets, 'jetbrains', {}, run).outcome).toBe(
      'unsigned',
    )
    prepare('xcode')
    expect(signArtifacts(fixture.root, fixture.assets, 'xcode', {}, run).outcome).toBe(
      'unsigned-local-only',
    )
    expect(publishArtifacts(fixture.root, fixture.assets, 'xcode', {}, run).outcome).toBe(
      'unsigned-local-only',
    )
    expect(run.mock.calls.every(([command]) => command === 'git')).toBe(true)
  })
  it('refuses partial signing credentials before invoking a signer', () => {
    prepare()
    expect(() =>
      signArtifacts(
        fixture.root,
        fixture.assets,
        'jetbrains',
        { JETBRAINS_PRIVATE_KEY: 'synthetic' },
        run,
      ),
    ).toThrow('MHP_HOST_SIGN_CREDENTIALS_INCOMPLETE')
    expect(run.mock.calls.every(([command]) => command === 'git')).toBe(true)
  })
  it('allows an unencrypted signing key without a password', () => {
    prepare()
    expect(
      signArtifacts(
        fixture.root,
        fixture.assets,
        'jetbrains',
        {
          JETBRAINS_CERTIFICATE_CHAIN: 'synthetic',
          JETBRAINS_PRIVATE_KEY: 'synthetic',
        },
        run,
      ).outcome,
    ).toBe('signed')
  })
  it('gives the signer only its own credentials and updates signed byte hashes', () => {
    prepare()
    const env = {
      PATH: 'path',
      JETBRAINS_PRIVATE_KEY: 'synthetic',
      JETBRAINS_CERTIFICATE_CHAIN: 'synthetic',
      JETBRAINS_PRIVATE_KEY_PASSWORD: 'synthetic',
      GH_TOKEN: 'synthetic',
      VSCE_PAT: 'synthetic',
    }
    const signer = vi.fn((command) => {
      if (command === 'git') return tree
      writeFileSync(path.join(fixture.assets, 'artifact.zip'), 'signed archive')
      return ''
    })
    expect(signArtifacts(fixture.root, fixture.assets, 'jetbrains', env, signer).outcome).toBe(
      'signed',
    )
    const options = signer.mock.calls.find(([command]) => command === 'sign')[2]
    expect(options.env).toMatchObject({ PATH: 'path', JETBRAINS_PRIVATE_KEY: 'synthetic' })
    expect(options.env.GH_TOKEN).toBeUndefined()
    expect(options.env.VSCE_PAT).toBeUndefined()
    expect(options.stdio).toBe('pipe')
    expect(
      verifyArtifacts(fixture.root, fixture.assets, 'jetbrains', run).sha256['artifact.zip'],
    ).toBe(digest('signed archive'))
  })
  it('fails supplied signing credentials without a real injected signing command', () => {
    prepare('visualstudio')
    const file = path.join(fixture.root, 'hosts', 'visualstudio', 'distribution.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    delete manifest.sign
    writeFileSync(file, JSON.stringify(manifest))
    expect(() =>
      signArtifacts(
        fixture.root,
        fixture.assets,
        'visualstudio',
        { WINDOWS_SIGNING_CERTIFICATE: 'synthetic', WINDOWS_SIGNING_PASSWORD: 'synthetic' },
        run,
      ),
    ).toThrow('MHP_HOST_SIGN_COMMAND_MISSING')
  })
  it('reports every missing registry credential and manual channel loudly', () => {
    prepare()
    expect(publishArtifacts(fixture.root, fixture.assets, 'jetbrains', {}, run)).toMatchObject({
      outcome: 'skipped-no-secret',
      reason: expect.stringContaining('JETBRAINS_MARKETPLACE_TOKEN'),
    })
    prepare('emacs')
    expect(publishArtifacts(fixture.root, fixture.assets, 'emacs', {}, run)).toMatchObject({
      outcome: 'manual-registry-submission',
      reason: 'MELPA (owner PR)',
    })
    expect(run.mock.calls.every(([command]) => command === 'git')).toBe(true)
  })
  it('publishes exact signed artifacts with only its channel credential', () => {
    prepare()
    expect(
      publishArtifacts(
        fixture.root,
        fixture.assets,
        'jetbrains',
        { JETBRAINS_MARKETPLACE_TOKEN: 'synthetic', VSCE_PAT: 'synthetic' },
        run,
      ).outcome,
    ).toBe('published')
    const options = run.mock.calls.find(([command]) => command === 'publish')[2]
    expect(options.env.JETBRAINS_MARKETPLACE_TOKEN).toBe('synthetic')
    expect(options.env.VSCE_PAT).toBeUndefined()
    expect(JSON.parse(options.env.MUSE_HOST_ARTIFACTS)).toEqual([
      path.join(fixture.assets, 'artifact.zip'),
    ])
  })
  it('refuses a publishing command that rebuilds or mutates the uploaded bytes', () => {
    prepare()
    expect(() =>
      publishArtifacts(
        fixture.root,
        fixture.assets,
        'jetbrains',
        { JETBRAINS_MARKETPLACE_TOKEN: 'synthetic' },
        mutatingPublisher,
      ),
    ).toThrow('MHP_HOST_RECEIPT_SHA256')
  })
  it('fails supplied registry credentials without a real injected publish command', () => {
    prepare()
    const file = path.join(fixture.root, 'hosts', 'jetbrains', 'distribution.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    delete manifest.publish
    writeFileSync(file, JSON.stringify(manifest))
    expect(() =>
      publishArtifacts(
        fixture.root,
        fixture.assets,
        'jetbrains',
        { JETBRAINS_MARKETPLACE_TOKEN: 'synthetic' },
        run,
      ),
    ).toThrow('MHP_HOST_PUBLISH_COMMAND_MISSING')
  })
  it('stages every verified native asset and receipt into the common release inventory', () => {
    const downloads = path.join(fixture.root, 'downloads')
    fixture.assets = path.join(downloads, 'm104-native-release-jetbrains')
    mkdirSync(fixture.assets, { recursive: true })
    prepare()
    const release = path.join(fixture.root, 'release')
    mkdirSync(release)
    expect(stageArtifacts(fixture.root, downloads, release, run).assets).toEqual([
      'artifact.zip',
      'muse-spark-code-jetbrains-1.2.3-receipt.json',
    ])
    expect(readFileSync(path.join(release, 'artifact.zip'), 'utf8')).toBe('archive')
    expect(readFileSync(path.join(release, '.native'), 'utf8')).toBe(
      'artifact.zip\nmuse-spark-code-jetbrains-1.2.3-receipt.json\n',
    )
    expect(() => stageArtifacts(fixture.root, downloads, release, run)).toThrow(
      'MHP_HOST_RELEASE_ASSET_COLLISION',
    )
  })
  it('refuses a missing host artifact download before staging any native release bytes', () => {
    prepare()
    const release = path.join(fixture.root, 'release')
    mkdirSync(release)
    expect(() =>
      stageArtifacts(fixture.root, path.join(fixture.root, 'missing'), release, run),
    ).toThrow()
  })
  it('rejects colliding native asset names across two hosts before copying', () => {
    const downloads = path.join(fixture.root, 'downloads')
    for (const host of ['jetbrains', 'eclipse']) {
      fixture.assets = path.join(downloads, `m104-native-release-${host}`)
      mkdirSync(fixture.assets, { recursive: true })
      prepare(host)
    }
    const release = path.join(fixture.root, 'release')
    mkdirSync(release)
    expect(() => stageArtifacts(fixture.root, downloads, release, run)).toThrow(
      'MHP_HOST_RELEASE_DUPLICATE_ASSET',
    )
  })
  it('names absent hosts in the channel summary and fails missing reports for present hosts', () => {
    expect(nativeSummary(fixture.root, fixture.assets).rows).toHaveLength(9)
    expect(nativeSummary(fixture.root, fixture.assets).failed).toBe(false)
    prepare()
    expect(nativeSummary(fixture.root, fixture.assets).failed).toBe(true)
    writeFileSync(
      path.join(fixture.assets, 'jetbrains.json'),
      JSON.stringify({ host: 'jetbrains', outcome: 'published' }),
    )
    const summary = nativeSummary(fixture.root, fixture.assets)
    expect(summary.failed).toBe(false)
    expect(summary.rows.at(-1).host).toBe('jetbrains')
  })
  it('refuses another host report, fabricated absence and malformed channel outcomes', () => {
    prepare()
    for (const result of [
      { host: 'eclipse', outcome: 'published' },
      { host: 'jetbrains', outcome: 'skipped-host-absent' },
      { host: 'jetbrains', outcome: 'success' },
    ]) {
      writeFileSync(path.join(fixture.assets, 'jetbrains.json'), JSON.stringify(result))
      expect(() => nativeSummary(fixture.root, fixture.assets)).toThrow()
    }
  })
  it('keeps the all-published signal false for missing registry credentials', () => {
    expect(nativeSummary(fixture.root, fixture.assets).allPublished).toBe(true)
    prepare()
    writeFileSync(
      path.join(fixture.assets, 'jetbrains.json'),
      JSON.stringify({
        host: 'jetbrains',
        outcome: 'skipped-no-secret',
        reason: 'registry credential absent',
      }),
    )
    expect(nativeSummary(fixture.root, fixture.assets).allPublished).toBe(false)
  })
  it('requires the exact archive and receipt to be attached before registry publication', () => {
    prepare()
    const download = vi.fn((command, args) => {
      if (command === 'git') return tree
      const name = args[args.indexOf('--pattern') + 1]
      const target = args[args.indexOf('--dir') + 1]
      writeFileSync(
        path.join(target, name),
        readFileSync(path.join(fixture.assets, name === 'artifact.zip' ? name : 'receipt.json')),
      )
      return ''
    })
    expect(
      verifyReleaseAssets(fixture.root, fixture.assets, 'jetbrains', 'v1.2.3', download).outcome,
    ).toBe('release-assets-verified')
    expect(download.mock.calls.filter(([command]) => command === 'gh')).toHaveLength(2)
    expect(() =>
      verifyReleaseAssets(fixture.root, fixture.assets, 'jetbrains', 'v1.2.4', download),
    ).toThrow('MHP_HOST_GITHUB_TAG')
    expect(() =>
      verifyReleaseAssets(fixture.root, fixture.assets, 'jetbrains', 'v1.2.3', corruptDownload),
    ).toThrow('MHP_HOST_GITHUB_SHA256')
  })
})

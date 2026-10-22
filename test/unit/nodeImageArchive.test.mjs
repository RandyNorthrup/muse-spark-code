import { Buffer } from 'node:buffer'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectNodeArchive, verifyReleaseIdentity } from '../../scripts/check-node-image.mjs'
import { recordCalls } from './helpers/recordCalls'

function refuseSignature() {
  throw new Error('signature rejected')
}

/** GNU tar crafts the hostile archives below; bsdtar cannot, so those two tests need it. */
function hasGnuTar() {
  try {
    return execFileSync('tar', ['--version'], { encoding: 'utf8', stdio: 'pipe' }).includes(
      'GNU tar',
    )
  } catch {
    return false
  }
}

const fixture = { root: '', oci: '', config: {}, layers: [], statements: [] }
const notices = [
  'opt/muse/image-notices/debian-packages.tsv',
  'opt/muse/image-notices/node.txt',
  'opt/muse/native-notices.json',
]
const indexType = 'application/vnd.oci.image.index.v1+json'
const manifestType = 'application/vnd.oci.image.manifest.v1+json'
const configType = 'application/vnd.oci.image.config.v1+json'
const put = (content, mediaType) => {
  const bytes =
    typeof content === 'object' && !Buffer.isBuffer(content)
      ? Buffer.from(JSON.stringify(content))
      : Buffer.from(content)
  const hash = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(path.join(fixture.oci, 'blobs/sha256', hash), bytes)
  return { digest: `sha256:${hash}`, size: bytes.length, mediaType }
}
const layer = (files, names = ['.']) => {
  const directory = mkdtempSync(path.join(fixture.root, 'layer-'))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(directory, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  const archive = `${directory}.tar.gz`
  execFileSync('tar', ['-czf', archive, '-C', directory, ...names])
  return put(readFileSync(archive), 'application/vnd.oci.image.layer.v1.tar+gzip')
}
const writeIndex = (mutate = (statements) => statements, binding) => {
  const config = put(fixture.config, configType)
  const image = put({ schemaVersion: 2, config, layers: fixture.layers }, manifestType)
  const statements = fixture.statements.map((entry) => ({
    _type: 'https://in-toto.io/Statement/v0.1',
    subject: [{ name: 'node', digest: { sha256: image.digest.slice(7) } }],
    ...entry,
  }))
  mutate(statements)
  const attestation = put(
    {
      schemaVersion: 2,
      config: put({}, configType),
      layers: statements.map((entry) => put(entry, 'application/vnd.in-toto+json')),
    },
    manifestType,
  )
  attestation.annotations = { 'vnd.docker.reference.type': 'attestation-manifest' }
  if (binding)
    attestation.annotations['vnd.docker.reference.digest'] =
      binding === 'image' ? image.digest : binding
  const root = put({ schemaVersion: 2, manifests: [image, attestation] }, indexType)
  writeFileSync(
    path.join(fixture.oci, 'index.json'),
    JSON.stringify({ schemaVersion: 2, manifests: [root] }),
  )
  return { image, root }
}
const inspect = () =>
  inspectNodeArchive(fixture.oci, {
    scanLayer: () => undefined,
    extractLayer: (file) => {
      const directory = path.join(mkdtempSync(path.join(fixture.root, 'extraction-')), 'files')
      execFileSync('python3', ['deploy/container/unpack.py', file, directory])
      const names = execFileSync('tar', ['-tf', file], { encoding: 'utf8' }).trim().split('\n')
      return { directory, names }
    },
  })
const emptySubjects = (statements) => {
  for (const statement of statements) statement.subject = []
}
beforeEach(() => {
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp/m110-c-archive-'))
  fixture.oci = path.join(fixture.root, 'oci')
  mkdirSync(path.join(fixture.oci, 'blobs/sha256'), { recursive: true })
  fixture.config = {
    architecture: 'amd64',
    os: 'linux',
    config: {
      Entrypoint: ['/usr/local/bin/muse-node-entrypoint'],
      Cmd: ['serve'],
      Env: ['PATH=/usr/bin:/bin'],
      Labels: { 'org.opencontainers.image.title': 'Muse Spark Code Node (Unofficial)' },
    },
  }
  fixture.layers = [
    layer({
      ...Object.fromEntries(notices.map((name) => [name, 'notice'])),
      'usr/local/bin/muse-node-entrypoint': readFileSync('deploy/container/entrypoint.sh'),
      'usr/local/bin/muse-spark-code-acp': readFileSync('deploy/container/muse-spark-code-acp'),
    }),
  ]
  fixture.statements = [
    {
      predicateType: 'https://spdx.dev/Document',
      predicate: { spdxVersion: 'SPDX-2.3', packages: [{ name: 'bash' }] },
    },
    {
      predicateType: 'https://slsa.dev/provenance/v0.2',
      predicate: { buildType: 'https://mobyproject.org/buildkit@v1' },
    },
  ]
})
afterEach(() => rmSync(fixture.root, { recursive: true, force: true }))

describe('OCI release gates', () => {
  it('checks real compressed blobs and binds both attestations to the runnable digest', () => {
    const { image, root } = writeIndex()
    const receipt = inspect()
    expect(receipt.digest).toBe(root.digest)
    expect(receipt.images[0]).toMatchObject({ platform: 'linux/amd64', digest: image.digest })
    expect(receipt.images[0].sbom.packages).toEqual([{ name: 'bash' }])
  })
  it('passes the actual CLI scanner on a clean OCI fixture', () => {
    writeIndex()
    const archive = path.join(fixture.root, 'clean.tar')
    const receipt = path.join(fixture.root, 'receipt.json')
    execFileSync('tar', ['-cf', archive, '-C', fixture.oci, '.'])
    const result = spawnSync(process.execPath, ['scripts/check-node-image.mjs', archive, receipt], {
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(receipt, 'utf8')).images[0].platform).toBe('linux/amd64')
  })
  it('rejects a tampered blob', () => {
    const { image } = writeIndex()
    writeFileSync(path.join(fixture.oci, 'blobs/sha256', image.digest.slice(7)), 'tampered')
    expect(inspect).toThrow('digest or size mismatch')
  })
  it('refuses multiple roots, duplicate platforms and archives without a runnable image', () => {
    const { image, root } = writeIndex()
    const index = JSON.parse(readFileSync(path.join(fixture.oci, 'index.json'), 'utf8'))
    index.manifests.push(root)
    writeFileSync(path.join(fixture.oci, 'index.json'), JSON.stringify(index))
    expect(inspect).toThrow('One image root')
    const inner = JSON.parse(
      readFileSync(path.join(fixture.oci, 'blobs/sha256', root.digest.slice(7)), 'utf8'),
    )
    fixture.config.config.Env.push('FIXTURE_VARIANT=other')
    const other = put(
      { schemaVersion: 2, config: put(fixture.config, configType), layers: fixture.layers },
      manifestType,
    )
    const duplicate = put({ ...inner, manifests: [...inner.manifests, other] }, indexType)
    writeFileSync(
      path.join(fixture.oci, 'index.json'),
      JSON.stringify({ schemaVersion: 2, manifests: [duplicate] }),
    )
    expect(inspect).toThrow('Duplicate OCI platform')
    const noImage = put(
      { ...inner, manifests: inner.manifests.filter((entry) => entry.digest !== image.digest) },
      indexType,
    )
    writeFileSync(
      path.join(fixture.oci, 'index.json'),
      JSON.stringify({ schemaVersion: 2, manifests: [noImage] }),
    )
    expect(inspect).toThrow('No runnable')
  })
  it('rejects same-length config corruption by digest', () => {
    const { image } = writeIndex()
    const manifest = JSON.parse(
      readFileSync(path.join(fixture.oci, 'blobs/sha256', image.digest.slice(7)), 'utf8'),
    )
    const config = path.join(fixture.oci, 'blobs/sha256', manifest.config.digest.slice(7))
    writeFileSync(
      config,
      readFileSync(config, 'utf8').replace('PATH=/usr/bin:/bin', 'PATH=/usr/bin;/bin'),
    )
    expect(inspect).toThrow('digest or size mismatch')
  })
  it('rejects an oversized compressed image before extraction', () => {
    fixture.layers[0].size = 200_000_001
    writeIndex()
    expect(inspect).toThrow('size budget')
  })
  it('rejects uncompressed layers and credential variables in config', () => {
    fixture.layers[0].mediaType = 'application/vnd.oci.image.layer.v1.tar'
    writeIndex()
    expect(inspect).toThrow('compressed OCI layers')
    fixture.layers[0].mediaType += '+gzip'
    fixture.config.config.Env.push('CANARY_API_KEY=fixture')
    writeIndex()
    expect(inspect).toThrow('Credential variable')
  })
  it('rejects lost unofficial branding', () => {
    fixture.config.config.Labels['org.opencontainers.image.title'] = 'Muse Node'
    writeIndex()
    expect(inspect).toThrow('unofficial')
  })
  it.each(['https://spdx.dev/Document', 'https://slsa.dev/provenance/v0.2'])(
    'rejects missing %s',
    (type) => {
      fixture.statements = fixture.statements.filter((entry) => entry.predicateType !== type)
      writeIndex()
      expect(inspect).toThrow('Missing SPDX')
    },
  )
  it.each(['sbom', 'provenance'])('rejects incomplete %s predicate contents', (kind) => {
    fixture.statements[kind === 'sbom' ? 0 : 1].predicate = kind === 'sbom' ? { packages: [] } : {}
    writeIndex()
    expect(inspect).toThrow('Missing SPDX')
  })
  it('rejects attestations for another image digest', () => {
    writeIndex((statements) => {
      for (const statement of statements) statement.subject[0].digest.sha256 = 'f'.repeat(64)
    })
    expect(inspect).toThrow('bound to image digest')
  })
  it('accepts captured BuildKit deferred subjects only with the runnable manifest binding', () => {
    fixture.statements = JSON.parse(
      readFileSync('test/fixtures/node-image/buildkit-attestations.json', 'utf8'),
    ).statements
    writeIndex(emptySubjects, 'image')
    expect(inspect().images[0].provenance.buildDefinition.buildType).toContain('buildkit')
    writeIndex(emptySubjects, `sha256:${'f'.repeat(64)}`)
    expect(inspect).toThrow('bound to image digest')
    writeIndex(emptySubjects)
    expect(inspect).toThrow()
  })
  it('rejects whiteouted notices and changed privilege bootstrap', () => {
    fixture.layers.push(layer({ 'opt/muse/image-notices/.wh.node.txt': '' }))
    writeIndex()
    expect(inspect).toThrow('licence notices')
  })
  it.each(['opt/muse/.wh.image-notices', 'opt/muse/image-notices/.wh..wh..opq'])(
    'rejects notices removed by directory whiteout %s',
    (name) => {
      fixture.layers.push(layer({ [name]: '' }))
      writeIndex()
      expect(inspect).toThrow('licence notices')
    },
  )
  it.each([
    ['.wh..wh..opq', 'licence notices'],
    ['opt/.wh..wh..opq', 'licence notices'],
    ['opt/muse/.wh..wh..opq', 'licence notices'],
    ['opt/muse/image-notices/.wh..wh..opq', 'licence notices'],
    ['usr/.wh..wh..opq', 'privilege bootstrap'],
    ['usr/local/.wh..wh..opq', 'privilege bootstrap'],
    ['usr/local/bin/.wh..wh..opq', 'privilege bootstrap'],
    ['.wh.opt', 'licence notices'],
    ['opt/.wh.muse', 'licence notices'],
    ['opt/muse/.wh.image-notices', 'licence notices'],
    ['opt/muse/image-notices/.wh.node.txt', 'licence notices'],
    ['.wh.usr', 'privilege bootstrap'],
    ['usr/.wh.local', 'privilege bootstrap'],
    ['usr/local/.wh.bin', 'privilege bootstrap'],
    ['usr/local/bin/.wh.muse-node-entrypoint', 'privilege bootstrap'],
  ])('rejects lower files removed by whiteout %s', (name, error) => {
    fixture.layers.push(layer({ [name]: '' }))
    writeIndex()
    expect(inspect).toThrow(error)
  })
  it('rejects launchers deleted by a root opaque whiteout even when notices return', () => {
    fixture.layers.push(
      layer({
        '.wh..wh..opq': '',
        ...Object.fromEntries(notices.map((name) => [name, 'replacement notice'])),
      }),
    )
    writeIndex()
    expect(inspect).toThrow('privilege bootstrap')
  })
  it.each([
    '.wh..wh..opq',
    'opt/.wh..wh..opq',
    'opt/muse/.wh..wh..opq',
    'opt/muse/image-notices/.wh..wh..opq',
    'usr/.wh..wh..opq',
    'usr/local/.wh..wh..opq',
    'usr/local/bin/.wh..wh..opq',
    '.wh.opt',
    'opt/.wh.muse',
    'opt/muse/.wh.image-notices',
    'opt/muse/image-notices/.wh.node.txt',
    '.wh.usr',
    'usr/.wh.local',
    'usr/local/.wh.bin',
    'usr/local/bin/.wh.muse-node-entrypoint',
  ])('retains same-layer replacements before and after whiteout %s', (name) => {
    const replacements = {
      ...Object.fromEntries(notices.map((notice) => [notice, 'replacement notice'])),
      'usr/local/bin/muse-node-entrypoint': readFileSync('deploy/container/entrypoint.sh'),
      'usr/local/bin/muse-spark-code-acp': readFileSync('deploy/container/muse-spark-code-acp'),
    }
    const files = { ...replacements, [name]: '' }
    for (const names of [
      [name, ...Object.keys(replacements)],
      [...Object.keys(replacements), name],
    ]) {
      fixture.layers.push(layer(files, names))
      writeIndex()
      expect(inspect().images[0].platform).toBe('linux/amd64')
      fixture.layers.pop()
    }
  })
  it.each(['.wh..wh..opq', 'usr/local/bin/.wh..wh..opq', 'usr/local/bin/.wh.muse-node-entrypoint'])(
    'rejects an unreviewed launcher reintroduced before whiteout %s',
    (name) => {
      const replacements = {
        ...Object.fromEntries(notices.map((notice) => [notice, 'replacement notice'])),
        'usr/local/bin/muse-node-entrypoint': '#!/bin/sh\nexec node /opt/muse/dist/node.js serve\n',
        'usr/local/bin/muse-spark-code-acp': readFileSync('deploy/container/muse-spark-code-acp'),
      }
      fixture.layers.push(
        layer({ ...replacements, [name]: '' }, [...Object.keys(replacements), name]),
      )
      writeIndex()
      expect(inspect).toThrow('privilege bootstrap')
    },
  )
  it('rejects a changed privilege bootstrap', () => {
    fixture.layers.push(
      layer({
        'usr/local/bin/muse-node-entrypoint': '#!/bin/sh\nexec node /opt/muse/dist/node.js serve\n',
      }),
    )
    writeIndex()
    expect(inspect).toThrow('privilege bootstrap')
  })
  it('scans a deleted canary in its original layer without exposing it in tool output', () => {
    // Synthetic high-entropy credential text; never a real key or sign-in.
    const canary = `api_key = "${createHash('sha256').update('m110 synthetic canary').digest('hex')}"`
    fixture.layers.push(layer({ 'deleted.txt': canary }), layer({ '.wh.deleted.txt': '' }))
    writeIndex()
    const archive = path.join(fixture.root, 'image.tar')
    execFileSync('tar', ['-cf', archive, '-C', fixture.oci, '.'])
    const result = spawnSync(
      process.execPath,
      ['scripts/check-node-image.mjs', archive, path.join(fixture.root, 'receipt.json')],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('secret scan failed')
    expect(`${result.stdout}${result.stderr}`).not.toContain(canary)
  })
  it('requires the exact keyless workflow identity, issuer and digest', () => {
    const execute = recordCalls()
    const reference = `ghcr.io/randynorthrup/muse-spark-code-node@sha256:${'1'.repeat(64)}`
    verifyReleaseIdentity(reference, 'v0.14.0', execute.fn)
    expect(execute.calls).toContainEqual([
      'cosign',
      [
        'verify',
        '--certificate-identity',
        'https://github.com/RandyNorthrup/muse-spark-code/.github/workflows/node-image.yml@refs/tags/v0.14.0',
        '--certificate-oidc-issuer',
        'https://token.actions.githubusercontent.com',
        reference,
      ],
      { stdio: 'pipe' },
    ])
    expect(() =>
      verifyReleaseIdentity(
        'ghcr.io/randynorthrup/muse-spark-code-node:stable',
        'v0.14.0',
        execute.fn,
      ),
    ).toThrow('Exact release')
    expect(() => verifyReleaseIdentity(reference, 'main', execute.fn)).toThrow('Exact release')
    expect(() =>
      verifyReleaseIdentity(reference.replace('ghcr.io', 'ghcrXio'), 'v0.14.0', execute.fn),
    ).toThrow('Exact release')
    expect(() => verifyReleaseIdentity(reference.slice(0, -1), 'v0.14.0', execute.fn)).toThrow(
      'Exact release',
    )
    expect(() => verifyReleaseIdentity(reference, 'v0.14.0', refuseSignature)).toThrow(
      'signature rejected',
    )
  })
  it('withholds malformed OCI JSON contents from CLI diagnostics', () => {
    fixture.config = Buffer.from('M110PRIVATE')
    writeIndex()
    const archive = path.join(fixture.root, 'malformed.tar')
    execFileSync('tar', ['-cf', archive, '-C', fixture.oci, '.'])
    const result = spawnSync(
      process.execPath,
      ['scripts/check-node-image.mjs', archive, path.join(fixture.root, 'receipt.json')],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).not.toContain('M110PRIVATE')
  })
  it.runIf(hasGnuTar())('extracts no archive symlink and refuses traversal', () => {
    const outside = path.join(fixture.root, 'outside')
    mkdirSync(outside)
    cpSync('LICENSE', path.join(outside, 'LICENSE'))
    const archive = path.join(fixture.root, 'unsafe.tar')
    execFileSync('tar', [
      '-cf',
      archive,
      '--transform=s|LICENSE|../escape|',
      '-C',
      outside,
      'LICENSE',
    ])
    const result = spawnSync(
      'python3',
      ['deploy/container/unpack.py', archive, path.join(fixture.root, 'unsafe')],
      { encoding: 'utf8' },
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unsafe archive member path')
    symlinkSync('../outside/LICENSE', path.join(outside, 'link'))
    execFileSync('tar', ['-cf', archive, '-C', outside, 'link'])
    const safe = path.join(fixture.root, 'no-links')
    execFileSync('python3', ['deploy/container/unpack.py', archive, safe])
    expect(() => readFileSync(path.join(safe, 'link'))).toThrow()
  })
  it.runIf(hasGnuTar())(
    'enforces extraction byte/file limits and refuses an existing destination',
    () => {
      const extractor = path.join(fixture.root, 'unpack.py')
      cpSync('deploy/container/unpack.py', extractor)
      const policy = path.join(fixture.root, 'policy.json')
      const source = path.join(fixture.root, 'bounded-source')
      mkdirSync(source)
      writeFileSync(path.join(source, 'first'), 'xx')
      writeFileSync(path.join(source, 'second'), 'xx')
      const archive = path.join(fixture.root, 'bounded.tar')
      execFileSync('tar', ['-cf', archive, '-C', source, '.'])
      for (const limits of [
        { maxExtractedBytes: 1, maxExtractedFiles: 100 },
        { maxExtractedBytes: 100, maxExtractedFiles: 1 },
      ]) {
        writeFileSync(policy, JSON.stringify(limits))
        const destination = path.join(mkdtempSync(path.join(fixture.root, 'bounded-')), 'files')
        const result = spawnSync('python3', [extractor, archive, destination], { encoding: 'utf8' })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('Archive extraction limit exceeded')
      }
      writeFileSync(policy, JSON.stringify({ maxExtractedBytes: 100, maxExtractedFiles: 100 }))
      const existing = path.join(fixture.root, 'existing-empty')
      mkdirSync(existing)
      expect(() =>
        execFileSync('python3', [extractor, archive, existing], { stdio: 'pipe' }),
      ).toThrow()
      execFileSync('tar', ['--hard-dereference', '-cf', archive, '-C', source, 'first', 'first'])
      const duplicate = spawnSync(
        'python3',
        [extractor, archive, path.join(fixture.root, 'duplicate')],
        {
          encoding: 'utf8',
        },
      )
      expect(duplicate.status).toBe(1)
      expect(duplicate.stderr).toContain('FileExistsError')
    },
  )
})

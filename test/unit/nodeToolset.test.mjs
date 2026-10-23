import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  downloadArtifact,
  parseToolset,
  readToolset,
  stageToolset,
  verifyArtifact,
} from '../../scripts/lib/nodeToolset.mjs'

const { Response, structuredClone } = globalThis
const shipped = JSON.parse(readFileSync('deploy/toolset/base.json', 'utf8'))
const repoRoot = process.cwd()

/** Records every call's arguments, running queued one-shot answers first. */
function recorder(defaultAnswer) {
  const calls = []
  const queue = []
  const fn = (...args) => {
    calls.push(args)
    return (queue.shift() ?? defaultAnswer)(...args)
  }
  fn.calls = calls
  fn.once = (answer) => {
    queue.push(answer)
  }
  return fn
}
const folders = []
function folder() {
  const result = mkdtempSync(path.join(tmpdir(), 'm110-b0-'))
  folders.push(result)
  return result
}
afterEach(async () => {
  process.chdir(repoRoot)
  await Promise.all(folders.splice(0).map((file) => rm(file, { recursive: true, force: true })))
})
const bytes = Buffer.from('abc')
const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
function pin() {
  return {
    ...shipped.architectures.amd64.artifacts[0],
    bytes: bytes.length,
    sha256: digest,
  }
}

describe('base toolset pins', () => {
  it('records both architectures, every required tool and the exact pinned container base', async () => {
    expect(await readToolset('deploy/toolset/base.json')).toEqual(shipped)
    const file = readFileSync('deploy/toolset/Containerfile', 'utf8')
    expect(file).toContain(`FROM ${shipped.baseImage} AS base`)
    expect(file).toContain('USER 10001:10001')
    expect(file).toContain('--mount=type=bind,from=artifacts')
    expect(file).toContain('COPY checksums /usr/local/share/muse-toolset/checksums')
    const installer = readFileSync('deploy/toolset/install.sh', 'utf8')
    expect(installer).toContain('sha256sum --strict -c "$checksums"')
    expect(installer.indexOf('sha256sum --strict -c "$checksums"')).toBeLessThan(
      installer.indexOf('dpkg --unpack'),
    )
    expect(installer).not.toContain('apt-get update')
    expect(installer.match(/tar --no-same-owner --no-same-permissions -xzf/g)).toHaveLength(4)
    expect(installer).toContain('chmod -R go-w /usr/local')
  })
  it.each([
    'schemaVersion',
    'image',
    'baseDigest',
    'capturedAt',
    'digest',
    'length',
    'version',
    'kind',
    'command',
  ])('refuses malformed %s boundary data', (kind) => {
    const raw = structuredClone(shipped)
    const record = raw.architectures.amd64
    const artifact = record.artifacts[0]
    switch (kind) {
      case 'schemaVersion': {
        raw.schemaVersion = 2
        break
      }
      case 'image': {
        raw.baseImage = 'debian:latest'
        break
      }
      case 'baseDigest': {
        record.baseDigest = 'sha256:wrong'
        break
      }
      case 'capturedAt': {
        raw.capturedAt = 'yesterday'
        break
      }
      case 'digest': {
        artifact.sha256 = 'wrong'
        break
      }
      case 'length': {
        artifact.bytes = -1
        break
      }
      case 'version': {
        artifact.version = 'not a version'
        break
      }
      case 'kind': {
        artifact.kind = 'executable'
        break
      }
      case 'command': {
        raw.tools[0].command = '../executable'
        break
      }
    }
    expect(() => parseToolset(raw)).toThrow()
  })
  it.each([
    'missing',
    'unknown',
    'duplicate',
    'duplicatePackage',
    'caseAlias',
    'dot',
    'path',
    'trailingDot',
    'source',
    'latest',
    'credentials',
    'fragment',
    'query',
    'archive',
    'wrongNode',
    'pack',
  ])('refuses %s manifest pins', (kind) => {
    const raw = structuredClone(shipped)
    const artifacts = raw.architectures.amd64.artifacts
    switch (kind) {
      case 'missing': {
        raw.tools.pop()
        break
      }
      case 'unknown': {
        raw.secret = 'unrecognised'
        break
      }
      case 'duplicate': {
        artifacts.push({ ...artifacts[0], name: 'different' })
        break
      }
      case 'duplicatePackage': {
        artifacts.push({ ...artifacts[0], file: 'different.deb' })
        break
      }
      case 'caseAlias': {
        artifacts.push({
          ...artifacts[0],
          name: 'different',
          file: artifacts[0].file.toUpperCase(),
        })
        break
      }
      case 'dot': {
        artifacts[0].file = '..'
        break
      }
      case 'path': {
        artifacts[0].file = String.raw`..\outside`
        break
      }
      case 'trailingDot': {
        artifacts[0].file = 'artifact.'
        break
      }
      case 'credentials': {
        artifacts[0].source = 'https://user:password@deb.debian.org/artifact'
        break
      }
      case 'fragment': {
        artifacts[0].source = 'https://deb.debian.org/artifact#fragment'
        break
      }
      case 'query': {
        artifacts[0].source = 'https://deb.debian.org/artifact?query=1'
        break
      }
      case 'archive': {
        artifacts[0].kind = 'tar'
        break
      }
      case 'source': {
        artifacts[0].source = 'https://127.0.0.1/metadata'
        break
      }
      case 'latest': {
        artifacts[0].source = 'https://github.com/project/releases/latest/download/tool'
        break
      }
      case 'wrongNode': {
        artifacts.find((item) => item.name === 'node').version = '22.0.0'
        break
      }
      case 'pack': {
        artifacts.find((item) => item.name === 'git').pack = 'build'
        break
      }
    }
    expect(() => parseToolset(raw)).toThrow()
  })
})

describe('verified artifact download', () => {
  it('downloads and publishes the exact digest, then independently verifies the file', async () => {
    const file = path.join(folder(), 'artifact')
    const fetcher = recorder(async () => new Response(bytes))
    await downloadArtifact(pin(), file, fetcher)
    await expect(verifyArtifact(file, pin())).resolves.toBeUndefined()
    expect(readFileSync(file)).toEqual(bytes)
    expect(existsSync(`${file}.part`)).toBe(false)
    expect(fetcher.calls[0][1].redirect).toBe('manual')
    expect(fetcher.calls[0][1].headers).toEqual({ 'Accept-Encoding': 'identity' })
  })
  it.each([
    'digest',
    'length',
    'overflow',
    'header',
    'status',
    'redirect',
    'redirectLimit',
    'noLocation',
  ])('refuses %s and cleans the partial file', async (kind) => {
    const file = path.join(folder(), 'artifact')
    let attempts = 0
    const fetcher = async () => {
      attempts += 1
      if (kind === 'redirectLimit' && attempts > 4) return new Response(bytes)
      if (kind === 'header') return new Response(bytes, { headers: { 'Content-Length': '10' } })
      if (kind === 'status') return new Response(bytes, { status: 403 })
      if (kind === 'redirect')
        return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } })
      if (kind === 'redirectLimit')
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://github.com/repeat' },
        })
      return kind === 'noLocation'
        ? new Response(null, { status: 302 })
        : new Response(Buffer.from({ digest: 'abd', length: 'ab' }[kind] ?? 'abcd'))
    }
    const message = {
      digest: 'integrity mismatch',
      length: 'integrity mismatch',
      overflow: 'exceeds pin',
      header: 'length mismatch',
      status: 'download refused',
      redirect: 'Unpinned toolset source',
      redirectLimit: 'redirect limit',
      noLocation: 'missing destination',
    }[kind]
    await expect(downloadArtifact(pin(), file, fetcher)).rejects.toThrow(message)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(`${file}.part`)).toBe(false)
  })
  it('allows an HTTPS release-asset redirect and still requires the pinned bytes', async () => {
    const file = path.join(folder(), 'artifact')
    const fetcher = recorder(async () => new Response(bytes))
    fetcher.once(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: 'https://release-assets.githubusercontent.com/asset?signature=public-test',
          },
        }),
    )
    await downloadArtifact(pin(), file, fetcher)
    expect(fetcher.calls[1][0]).toBe(
      'https://release-assets.githubusercontent.com/asset?signature=public-test',
    )
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(digest)
  })
  it('refuses a modified cache file by both length and digest', async () => {
    const file = path.join(folder(), 'artifact')
    writeFileSync(file, 'abd')
    await expect(verifyArtifact(file, pin())).rejects.toThrow('SHA-256')
    writeFileSync(file, 'ab')
    await expect(verifyArtifact(file, pin())).rejects.toThrow('length')
  })
})

function cacheFixture() {
  const manifest = structuredClone(shipped)
  const cache = folder()
  for (const record of Object.values(manifest.architectures)) {
    for (const pin of record.artifacts) {
      pin.bytes = bytes.length
      pin.sha256 = digest
      writeFileSync(path.join(cache, pin.file), bytes)
    }
  }
  return { manifest: parseToolset(manifest), cache }
}

describe('offline staging', () => {
  it('stages both packs with complete checksum lists and refuses to reuse an existing directory', async () => {
    const { manifest, cache } = cacheFixture()
    const destination = path.join(folder(), 'new')
    const total = await stageToolset(manifest, 'amd64', destination, cache)
    expect(total).toBe(manifest.architectures.amd64.artifacts.length * bytes.length)
    for (const pack of ['base', 'build']) {
      const inventory = readFileSync(
        path.join(destination, 'artifacts', pack, 'SHA256SUMS'),
        'utf8',
      )
      expect(readFileSync(path.join(destination, 'checksums', `${pack}.sha256`), 'utf8')).toBe(
        inventory,
      )
      const lines = inventory.trim().split('\n')
      expect(lines).toHaveLength(
        manifest.architectures.amd64.artifacts.filter((pin) => pin.pack === pack).length,
      )
      for (const line of lines)
        expect(line).toMatch(
          new RegExp(String.raw`^${digest}  (?:debs/|licenses/|node\.tar|uv\.tar|gitleaks\.tar)`),
        )
    }
    await expect(stageToolset(manifest, 'amd64', destination, cache)).rejects.toThrow()
    expect(existsSync(path.join(destination, 'base.json'))).toBe(true)
  })
  it('refuses unsupported architectures before creating a directory', async () => {
    const destination = path.join(folder(), 'new')
    await expect(stageToolset(shipped, 'riscv64', destination)).rejects.toThrow('Unsupported')
    expect(existsSync(destination)).toBe(false)
  })
  it('rejects a changed cache before building, removes only its new stage and preserves the cache', async () => {
    const { manifest, cache } = cacheFixture()
    const first = manifest.architectures.amd64.artifacts.find((item) => item.pack === 'base')
    writeFileSync(path.join(cache, first.file), 'damaged')
    const destination = path.join(folder(), 'new')
    await expect(stageToolset(manifest, 'amd64', destination, cache)).rejects.toThrow('length')
    expect(existsSync(destination)).toBe(false)
    expect(readFileSync(path.join(cache, first.file), 'utf8')).toBe('damaged')
  })
  it.each(['Containerfile', 'install.sh', 'vendor', 'first-party-skills'])(
    'cleans a failed %s copy and permits retry of the complete context',
    async (asset) => {
      const { manifest, cache } = cacheFixture()
      const destination = path.join(folder(), 'new')
      // stageToolset reads its context sources from the working directory; a
      // fixture holding every source but the named one fails that real copy.
      const fixture = folder()
      mkdirSync(path.join(fixture, 'deploy', 'toolset'), { recursive: true })
      for (const file of ['Containerfile', 'install.sh']) {
        if (file === asset) continue
        cpSync(
          path.join(repoRoot, 'deploy', 'toolset', file),
          path.join(fixture, 'deploy', 'toolset', file),
        )
      }
      // A tree failure needs the file copies to pass first; the file cases
      // fail before any tree copy starts.
      if (asset !== 'Containerfile' && asset !== 'install.sh') {
        for (const tree of ['vendor', 'first-party-skills']) {
          if (tree === asset) continue
          cpSync(path.join(repoRoot, tree), path.join(fixture, tree), { recursive: true })
        }
      }
      const here = process.cwd()
      process.chdir(fixture)
      try {
        await expect(stageToolset(manifest, 'amd64', destination, cache)).rejects.toThrow('ENOENT')
      } finally {
        process.chdir(here)
      }
      expect(existsSync(destination)).toBe(false)
      expect(
        readFileSync(path.join(cache, manifest.architectures.amd64.artifacts[0].file)),
      ).toEqual(bytes)
      await expect(stageToolset(manifest, 'amd64', destination, cache)).resolves.toBeGreaterThan(0)
      for (const file of ['Containerfile', 'install.sh'])
        expect(readFileSync(path.join(destination, file))).toEqual(
          readFileSync(path.join('deploy/toolset', file)),
        )
      expect(
        existsSync(
          path.join(destination, 'assets', 'vendor', 'high-quality-projects-skill', 'VENDOR.json'),
        ),
      ).toBe(true)
      expect(
        existsSync(
          path.join(destination, 'assets', 'first-party-skills', 'muse_gadgets', 'SKILL.md'),
        ),
      ).toBe(true)
    },
  )
})

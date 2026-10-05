import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fileIdentity from '../../src/core/fs/fileIdentity'
import { verifyDiskModel } from '../../src/core/judge/local/model'
import capture from './fixtures/localJudgeCapture.json'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function diskModel() {
  const temporary = path.resolve('temp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(path.join(temporary, 'local-judge-model-'))
  roots.push(root)
  const manifestDir = path.join(root, 'manifests/registry.ollama.ai/library/test')
  const blobs = path.join(root, 'blobs')
  await mkdir(manifestDir, { recursive: true })
  await mkdir(blobs)
  const content = Buffer.from('synthetic weights in a test fixture')
  const digest = createHash('sha256').update(content).digest('hex')
  const blob = {
    mediaType: 'application/vnd.ollama.image.model',
    digest: `sha256:${digest}`,
    size: content.length,
  }
  const manifest = Buffer.from(
    JSON.stringify({
      ...capture.manifest,
      config: { ...blob, mediaType: 'application/vnd.docker.container.image.v1+json' },
      layers: [blob],
    }),
  )
  const manifestPath = path.join(manifestDir, 'latest')
  const blobPath = path.join(blobs, `sha256-${digest}`)
  await writeFile(manifestPath, manifest)
  await writeFile(blobPath, content)
  const tags = {
    models: [{ name: 'test:latest', digest: createHash('sha256').update(manifest).digest('hex') }],
  }
  return { root, tags, manifestPath, blobPath, content }
}

describe('M98-2j captured model provenance', () => {
  it('records the real served digest as the digest of the captured manifest', () => {
    const actual = capture.tags.models.find((model) => model.name === capture.chat.model)
    expect(actual?.digest).toBe('0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0')
    expect(capture.chat.message.content).toBe('no')
    expect(capture.chat.eval_count).toBe(1)
    expect(capture.chat.logprobs[0]?.top_logprobs).toHaveLength(5)
  })

  it('hashes every referenced blob, including the weights', async () => {
    const fixture = await diskModel()
    await expect(verifyDiskModel(fixture.tags, 'test:latest', fixture.root)).resolves.toEqual({
      digest: fixture.tags.models[0]!.digest,
      weightBytes: fixture.content.length,
    })
  })

  it.each(['digest', 'size', 'missing', 'manifest', 'duplicate', 'absent'])(
    'refuses %s ambiguity',
    async (fault) => {
      const fixture = await diskModel()
      switch (fault) {
        case 'digest': {
          await writeFile(fixture.blobPath, Buffer.alloc(fixture.content.length))
          break
        }
        case 'size': {
          await writeFile(fixture.blobPath, 'short')
          break
        }
        case 'missing': {
          await rm(fixture.blobPath)
          break
        }
        case 'manifest': {
          await writeFile(
            fixture.manifestPath,
            Buffer.concat([await readFile(fixture.manifestPath), Buffer.from(' ')]),
          )
          break
        }
        case 'duplicate': {
          fixture.tags.models.push(fixture.tags.models[0]!)
          break
        }
        case 'absent': {
          fixture.tags.models.length = 0
          break
        }
      }
      await expect(verifyDiskModel(fixture.tags, 'test:latest', fixture.root)).rejects.toThrow()
    },
  )

  it('refuses names traversing outside the model directory and unknown shapes', async () => {
    const fixture = await diskModel()
    await expect(
      verifyDiskModel(fixture.tags, '../../secret:latest', fixture.root),
    ).rejects.toThrow('unverified-model-name')
    await expect(
      verifyDiskModel({ models: [{ name: 'test:latest' }] }, 'test:latest', fixture.root),
    ).rejects.toThrow()
  })

  it('refuses a pathname replacement while the original blob handle remains valid', async () => {
    const fixture = await diskModel()
    const sample = fileIdentity.handleIdentity
    let count = 0
    vi.spyOn(fileIdentity, 'handleIdentity').mockImplementation(async (handle) => {
      const result = await sample(handle)
      count++
      if (count === 5) {
        await rename(fixture.blobPath, `${fixture.blobPath}.old`)
        await writeFile(fixture.blobPath, Buffer.alloc(fixture.content.length))
      }
      return result
    })
    await expect(verifyDiskModel(fixture.tags, 'test:latest', fixture.root)).rejects.toThrow(
      'unverified-blob-digest',
    )
  })

  it('refuses blobs that never matched in one consistent snapshot', async () => {
    const fixture = await diskModel()
    const template = Buffer.from('synthetic template')
    const digest = createHash('sha256').update(template).digest('hex')
    const templatePath = path.join(fixture.root, 'blobs', `sha256-${digest}`)
    const decoded: unknown = JSON.parse((await readFile(fixture.manifestPath)).toString())
    const manifest = { ...capture.manifest, config: capture.manifest.config, layers: [] }
    // This fixture uses the already captured manifest shape, with synthetic blobs only.
    if (!decoded || typeof decoded !== 'object' || !('config' in decoded) || !('layers' in decoded))
      throw new Error('invalid test manifest')
    const bytes = Buffer.from(JSON.stringify({
      ...manifest,
      config: decoded.config,
      layers: [
        ...(Array.isArray(decoded.layers) ? decoded.layers : []),
        { mediaType: 'application/vnd.ollama.image.template', digest: `sha256:${digest}`, size: template.length },
      ],
    }))
    await writeFile(fixture.manifestPath, bytes)
    fixture.tags.models[0]!.digest = createHash('sha256').update(bytes).digest('hex')
    await writeFile(templatePath, Buffer.alloc(template.length))
    const sample = fileIdentity.statIdentity
    let weightReads = 0
    vi.spyOn(fileIdentity, 'statIdentity').mockImplementation(async (file) => {
      const result = await sample(file)
      if (file === fixture.blobPath && ++weightReads === 2) {
        await writeFile(fixture.blobPath, Buffer.alloc(fixture.content.length))
        await writeFile(templatePath, template)
      }
      return result
    })
    await expect(verifyDiskModel(fixture.tags, 'test:latest', fixture.root)).rejects.toThrow(
      'unverified-blob',
    )
  })

  it('refuses a redirected blob directory even when every digest matches', async () => {
    const fixture = await diskModel()
    const blobs = path.join(fixture.root, 'blobs')
    const redirected = path.join(fixture.root, 'blobs-real')
    await rename(blobs, redirected)
    await symlink(redirected, blobs, 'junction')
    await expect(verifyDiskModel(fixture.tags, 'test:latest', fixture.root)).rejects.toThrow(
      'unverified-model-path',
    )
  })
})

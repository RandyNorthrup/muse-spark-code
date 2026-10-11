import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { fakeFilesServer } from './helpers/media/fakeFilesServer'
import { ebmlFixture, mp3Fixture, videoFixture, wavFixture } from './helpers/media/fixtures'

// These small projections exercise the injected transport, not a provider
// response parser. Replace them with the lead's raw U6 frames in lane F.
const projection = { id: 'file-fake', expires_at: 1_800_000_000 }

function multipart(hasExpiry: boolean, bytes: Uint8Array = videoFixture()) {
  const form = new FormData()
  form.append('file', new Blob([Uint8Array.from(bytes)], { type: 'video/mp4' }), 'clip.mp4')
  form.append('purpose', 'user_data')
  if (hasExpiry) {
    form.append('expires_after[anchor]', 'created_at')
    form.append('expires_after[seconds]', '3600')
  }
  return form
}

describe('U6 fake Files transport with injected frames', () => {
  it('uploads with expiry, retrieves, lists, returns byte-exact content, deletes and closes', async () => {
    let uploaded: Uint8Array | undefined
    const server = await fakeFilesServer({
      upload: (file) => {
        uploaded = file.bytes
        return projection
      },
      retrieve: () => projection,
      list: () => ({ data: uploaded === undefined ? [] : [projection] }),
      delete: (id) => {
        uploaded = undefined
        return { id, deleted: true }
      },
      content: () => uploaded,
    })
    try {
      const bytes = videoFixture()
      const upload = await fetch(`${server.baseUrl}/files`, {
        method: 'POST',
        body: multipart(true, bytes),
      })
      expect(await upload.json()).toEqual(projection)
      expect(server.uploads).toEqual([
        { name: 'clip.mp4', mime: 'video/mp4', bytes, expirySeconds: 3600 },
      ])
      expect(server.receivedChunkSizes.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(
        bytes.length,
      )
      const get = (suffix: string) => fetch(`${server.baseUrl}/files${suffix}`)
      const retrieved = await get('/file-fake')
      const listed = await get('')
      const content = await get('/file-fake/content')
      expect(await retrieved.json()).toEqual(projection)
      expect(await listed.json()).toEqual({ data: [projection] })
      expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes)
      const deleted = await fetch(`${server.baseUrl}/files/file-fake`, { method: 'DELETE' })
      expect(await deleted.json()).toEqual({ id: 'file-fake', deleted: true })
      expect(server.deletedIds).toEqual(['file-fake'])
      const afterDelete = await get('')
      const deletedContent = await get('/file-fake/content')
      const unknownRoute = await get('/unsupported/route')
      expect(await afterDelete.json()).toEqual({ data: [] })
      expect(deletedContent.status).toBe(404)
      expect(unknownRoute.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('refuses a multipart upload without expiry before invoking the frame factory', async () => {
    const server = await fakeFilesServer({
      upload: () => {
        throw new Error('Must not accept expiry-free uploads')
      },
      retrieve: () => {
        throw new Error('Not used')
      },
      list: () => {
        throw new Error('Not used')
      },
      delete: () => {
        throw new Error('Not used')
      },
      content: () => undefined,
    })
    try {
      const result = await fetch(`${server.baseUrl}/files`, {
        method: 'POST',
        body: multipart(false),
      })
      expect(result.status).toBe(400)
      expect(server.uploads).toEqual([])
    } finally {
      await server.close()
    }
  })
})

describe('M105 bounded generated sniffing fixtures', () => {
  it('builds the planned ISO-BMFF variants under the binary fixture bound', () => {
    for (const brand of ['isom', 'mp42', 'avc1', 'qt  ', 'M4A '] as const) {
      const bytes = Buffer.from(videoFixture({ brand, moovLast: true, soundtrack: false }))
      expect(bytes.toString('ascii', 8, 12)).toBe(brand)
      expect(bytes.indexOf('moov')).toBeGreaterThan(bytes.indexOf('mdat'))
      expect(bytes.includes(Buffer.from('soun'))).toBe(false)
      expect(bytes.length).toBeLessThan(64 * 1024)
    }
    const fragmented = Buffer.from(videoFixture({ fragmented: true }))
    expect(fragmented.includes(Buffer.from('moof'))).toBe(true)
    expect(fragmented.includes(Buffer.from('soun'))).toBe(true)
    const huge = Buffer.from(videoFixture({ oversizedMoov: true }))
    expect(huge.readUInt32BE(huge.indexOf('moov') - 4)).toBe(0xff_ff_ff_ff)
  })

  it('builds RIFF, tagged/bare MP3, WebM and Matroska headers without stored binaries', () => {
    const wav = Buffer.from(wavFixture())
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt32LE(40)).toBe(16_000)
    expect(Buffer.from(mp3Fixture()).toString('ascii', 0, 3)).toBe('ID3')
    expect([...mp3Fixture(false).slice(0, 2)]).toEqual([0xff, 0xfb])
    for (const kind of ['webm', 'matroska'] as const) {
      const bytes = Buffer.from(ebmlFixture(kind))
      expect(bytes.includes(Buffer.from(kind))).toBe(true)
      expect(bytes.length).toBeLessThan(64 * 1024)
    }
    // A renamed or truncated fixture is derived by the test; names never
    // change its header and truncated bytes require no separate binary file.
    expect(videoFixture().slice(0, 7)).toHaveLength(7)
  })
})

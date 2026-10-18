// A workspace rooted at the filesystem itself still reopens adopted media:
// the root already ends in the separator, so the containment prefix must not
// gain a second one (`//`), or every child fails the check and restores as
// unavailable.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { workspaceMediaSource } from '../../src/core/media/productionMedia'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==',
  'base64',
)
const signal = new AbortController().signal

function sourceFor(platform: NodeJS.Platform, workspaceRoot: string) {
  const seen: string[] = []
  const chunk = Promise.resolve(new Uint8Array(PNG))
  const digest = createHash('sha256').update(PNG).digest('hex')
  const source = workspaceMediaSource({
    workspaceRoot,
    platform,
    io: {
      readMedia: (absolute: string) => {
        seen.push(absolute)
        return Promise.resolve({
          info: {
            kind: 'image' as const,
            mediaType: 'image/png' as const,
            sizeBytes: PNG.length,
            width: 1,
            height: 1,
          },
          sha256: digest,
          source: {
            name: 'tile.png',
            mime: 'image/png',
            bytes: PNG.length,
            open: async function* () {
              yield await chunk
            },
          },
        })
      },
    },
  })
  return { source, seen, digest }
}

describe('workspace media source at the filesystem root', () => {
  it.each([
    ['posix', '/', '/tile.png'],
    ['win32', 'C:/', String.raw`C:\tile.png`],
  ] as const)('reopens the adopted file under a %s root', async (platform, root, absolute) => {
    const { source, seen, digest } = sourceFor(platform, root)
    const reopened = await source(
      {
        name: 'tile.png',
        info: {
          kind: 'image',
          mediaType: 'image/png',
          sizeBytes: PNG.length,
          width: 1,
          height: 1,
        },
        sha256: digest,
      },
      signal,
    )
    expect(seen).toEqual([absolute])
    expect(reopened?.name).toBe('tile.png')
  })
})

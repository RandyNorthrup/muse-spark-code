// A workspace rooted at the filesystem itself still reopens adopted media:
// the root already ends in the separator, so the containment prefix must not
// gain a second one (`//`), or every child fails the check and restores as
// unavailable.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { workspaceMediaSource } from '../../src/core/media/productionMedia'
import { videoFixture } from './helpers/media/fixtures'

const signal = new AbortController().signal

function sourceFor(platform: NodeJS.Platform, workspaceRoot: string) {
  const seen: string[] = []
  const bytes = videoFixture({ soundtrack: false })
  const info = sniffMediaBytes(bytes)
  if (info === undefined) throw new Error('the video fixture must sniff as media')
  const chunk = Promise.resolve(new Uint8Array(bytes))
  const digest = createHash('sha256').update(bytes).digest('hex')
  const source = workspaceMediaSource({
    workspaceRoot,
    platform,
    io: {
      readMedia: (absolute: string) => {
        seen.push(absolute)
        return Promise.resolve({
          info,
          sha256: digest,
          source: {
            name: 'clip.mp4',
            mime: info.mediaType,
            bytes: bytes.length,
            open: async function* (active: AbortSignal) {
              active.throwIfAborted()
              yield await chunk
            },
          },
        })
      },
    },
  })
  return { source, seen, digest, info }
}

describe('workspace media source at the filesystem root', () => {
  it.each([
    ['linux', '/', '/clip.mp4'],
    ['win32', 'C:/', String.raw`C:\clip.mp4`],
  ] as const)('reopens the adopted file under a %s root', async (platform, root, absolute) => {
    const { source, seen, digest, info } = sourceFor(platform, root)
    const reopened = await source({ name: 'clip.mp4', info, sha256: digest }, signal)
    expect(seen).toEqual([absolute])
    expect(reopened?.name).toBe('clip.mp4')
  })
})

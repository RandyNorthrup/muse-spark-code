import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@agentclientprotocol/sdk'
import { AcpMedia, type AcpMediaDeps } from '../../src/acp/media'
import { resourceName } from '../../src/acp/translate'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { MediaModelCapabilities } from '../../src/core/media/modalityGate'
import { wavFixture } from './helpers/media/fixtures'

const model: MediaModelCapabilities = {
  modelId: 'test-audio',
  modelName: 'Test Audio',
  provider: 'test',
  modalities: {
    image: { support: 'no', formats: [] },
    document: { support: 'no', formats: [] },
    video: { support: 'no', formats: [] },
    audio: { support: 'yes', formats: ['audio/wav'], hearsStandaloneAudio: 'yes' },
  },
  files: 'yes',
}

function deps(prepare: AcpMediaDeps['prepare']): AcpMediaDeps {
  return {
    cwd: '/work',
    platform: process.platform,
    sessionId: 'session',
    backend: 'modelApi',
    modelId: () => model.modelId,
    interactive: true,
    model: () => model,
    io: {
      realPath: (absolutePath: string) => Promise.resolve(absolutePath),
      readBytes: () => Promise.resolve(undefined),
    },
    assertReadable: () => Promise.resolve(),
    prepare,
  }
}

function audioBlock(data: string): Extract<ContentBlock, { type: 'audio' }> {
  return { type: 'audio', data } as Extract<ContentBlock, { type: 'audio' }>
}

describe('media refusals', () => {
  it('names an undecodable blob in fixed words', async () => {
    const media = new AcpMedia(deps(() => Promise.reject(new Error('prepare ran'))))
    const result = await media.block(audioBlock('!!!not-base64!!!'), new AbortController().signal)
    expect(result).toBe(fill(UI_TEXT.media.attachmentUnknownType, { type: 'blob' }))
  })

  it('raises a foreign prepare failure unreadable, carrying the failure', async () => {
    const blown = new Error('provider exploded')
    const media = new AcpMedia(deps(() => Promise.reject(blown)))
    const bytes = Buffer.from(wavFixture(1)).toString('base64')
    let failure: unknown
    try {
      await media.block(audioBlock(bytes), new AbortController().signal)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.attachmentUnreadable)
    expect((failure as Error).cause).toBe(blown)
  })
})

describe('resourceName', () => {
  it('keeps the raw name past a malformed URL or escape', () => {
    expect(resourceName('::not a url::')).toBe('::not a url::')
    expect(resourceName('https://example.invalid/%XX')).toBe('%XX')
  })
})

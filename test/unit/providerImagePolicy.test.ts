// XAI-G11: xAI documents jpg/jpeg and png up to 20 MiB for image
// understanding (docs.x.ai image-understanding, read 2026-10-13); a gif,
// webp or x-icon attachment, or one over the documented size, must be
// refused with a reason before anything is sent. Pure: real modules only.
import { describe, expect, it } from 'vitest'
import { modalityGate } from '../../src/core/media/modalityGate'
import { resolveModelCapabilities } from '../../src/core/providers/capabilityRecord'
import { nativeCapabilityEvidence } from '../../src/core/providers/modelMetadata'
import { projectMediaCapabilities } from '../../src/host/media/mediaProviders'
import { MAX_IMAGE_BYTES, XAI_MAX_IMAGE_BYTES } from '../../src/shared/constants'

const preset = { kind: 'preset' as const, ref: 'xai' }
const imageNative = { architecture: { input_modalities: ['text', 'image'] } }

function xaiImagePolicy() {
  const evidence = nativeCapabilityEvidence('xai', imageNative, preset)
  const record = resolveModelCapabilities(
    { provider: 'xai', nativeModel: 'grok-4', format: 'chat' },
    [evidence],
  )
  if (record.modalities.image.state !== 'yes') throw new Error('xAI image support missing')
  return record.modalities.image.value
}

describe('XAI-G11 provider image policy', () => {
  it('records only the documented xAI image formats and size', () => {
    expect(xaiImagePolicy().mimes).toEqual(['image/png', 'image/jpeg'])
    expect(xaiImagePolicy().maxBytes).toBe(XAI_MAX_IMAGE_BYTES)
    expect(XAI_MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024)
  })

  it('leaves other providers on the established image policy', () => {
    const evidence = nativeCapabilityEvidence(
      'openai',
      { architecture: { input_modalities: ['text', 'image'] } },
      { kind: 'preset', ref: 'openai' },
    )
    const record = resolveModelCapabilities(
      { provider: 'openai', nativeModel: 'gpt-4.1', format: 'responses' },
      [evidence],
    )
    if (record.modalities.image.state !== 'yes') throw new Error('image support missing')
    expect(record.modalities.image.value.mimes).toContain('image/gif')
    expect(record.modalities.image.value.mimes).toContain('image/webp')
    expect(record.modalities.image.value.maxBytes).toBe(MAX_IMAGE_BYTES)
  })

  it('projects the documented xAI formats and size at attach time', () => {
    const capabilities = projectMediaCapabilities('xai/grok-4')
    expect(capabilities.modalities.image.formats).toEqual(['image/png', 'image/jpeg'])
    expect(capabilities.modalities.image.inlineMaxBytes).toBe(20 * 1024 * 1024)
  })

  it('keeps the established projection for Meta models', () => {
    const capabilities = projectMediaCapabilities('muse-spark-1.3')
    expect(capabilities.modalities.image.formats).toContain('image/gif')
    expect(capabilities.modalities.image.formats).toContain('image/webp')
    expect(capabilities.modalities.image.inlineMaxBytes).toBe(MAX_IMAGE_BYTES)
  })

  it('refuses an undocumented xAI format before sending, with a reason', () => {
    const capabilities = projectMediaCapabilities('xai/grok-4')
    const refused = modalityGate(
      { kind: 'image', mediaType: 'image/gif', sizeBytes: 1024 },
      capabilities,
    )
    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('gif must be refused for xAI')
    expect(refused.reason.length).toBeGreaterThan(0)
    const allowed = modalityGate(
      { kind: 'image', mediaType: 'image/png', sizeBytes: 15 * 1024 * 1024 },
      capabilities,
    )
    expect(allowed).toEqual({ ok: true })
  })

  it('refuses an over-size xAI image before sending, with a reason', () => {
    const capabilities = projectMediaCapabilities('xai/grok-4')
    const refused = modalityGate(
      { kind: 'image', mediaType: 'image/png', sizeBytes: 21 * 1024 * 1024 },
      capabilities,
    )
    expect(refused.ok).toBe(false)
  })
})

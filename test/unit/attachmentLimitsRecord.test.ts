import { describe, expect, it } from 'vitest'
import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MODEL_API_MEDIA_PER_REQUEST,
  MODEL_API_PDF_PAGE_IMAGES,
} from '../../src/shared/constants'
import { attachmentLimitsForModel } from '../../src/core/backends/modelapi/modelPolicy'
import {
  attachmentLimitsForRecord,
  metaCapabilityRecord,
  resolveModelCapabilities,
} from '../../src/core/providers/capabilityRecord'

describe('A10 attachment limits from the capability record', () => {
  it('meta models read confirmed limits from their own record', () => {
    const limits = attachmentLimitsForModel('muse-spark-1.3')
    expect(limits.imageConfirmed).toBe(true)
    expect(limits.documentConfirmed).toBe(true)
    expect(limits.imageMaxBytes).toBe(MAX_IMAGE_BYTES)
    expect(limits.imageMaxCount).toBe(MODEL_API_MEDIA_PER_REQUEST)
    expect(limits.documentMaxBytes).toBe(MAX_DOCUMENT_BYTES)
    expect(limits.pdfMaxPages).toBe(MODEL_API_PDF_PAGE_IMAGES)
  })

  it('a model without a record keeps today’s values, marked unconfirmed', () => {
    const limits = attachmentLimitsForModel('anthropic/claude-opus-4-6')
    expect(limits.imageConfirmed).toBe(false)
    expect(limits.documentConfirmed).toBe(false)
    expect(limits.imageMaxBytes).toBe(MAX_IMAGE_BYTES)
    expect(limits.imageMaxCount).toBe(MODEL_API_MEDIA_PER_REQUEST)
    expect(limits.documentMaxBytes).toBe(MAX_DOCUMENT_BYTES)
    expect(limits.pdfMaxPages).toBe(MODEL_API_PDF_PAGE_IMAGES)
  })

  it('a record stating only some limits confirms only those', () => {
    const source = { kind: 'models-list' as const, ref: 'models' }
    const record = resolveModelCapabilities(
      { provider: 'acme', nativeModel: 'acme-1', format: 'responses' },
      [
        {
          source,
          fields: {
            modalities: {
              image: {
                state: 'yes',
                value: { mimes: ['image/png'], maxBytes: 1024 },
                source,
              },
            },
          },
        },
      ],
    )
    const limits = attachmentLimitsForRecord(record)
    expect(limits.imageMaxBytes).toBe(1024)
    expect(limits.imageConfirmed).toBe(false)
    expect(limits.imageMaxCount).toBe(MODEL_API_MEDIA_PER_REQUEST)
    expect(limits.documentConfirmed).toBe(false)
    expect(limits.documentMaxBytes).toBe(MAX_DOCUMENT_BYTES)
  })

  it('the meta record states every enforced attachment limit', () => {
    const limits = attachmentLimitsForRecord(metaCapabilityRecord('muse-spark-1.3'))
    expect(limits.imageConfirmed).toBe(true)
    expect(limits.documentConfirmed).toBe(true)
  })
})

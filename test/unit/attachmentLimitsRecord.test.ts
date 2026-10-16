import { describe, expect, it } from 'vitest'
import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MODEL_API_MEDIA_PER_REQUEST,
  MODEL_API_PDF_PAGE_IMAGES,
} from '../../src/shared/constants'
import {
  attachmentLimitsForModel,
  attachmentLimitsForRecord,
} from '../../src/core/backends/modelapi/modelPolicy'
import {
  metaCapabilityRecord,
  resolveModelCapabilities,
} from '../../src/core/providers/capabilityRecord'

describe('A10 attachment limits from the capability record', () => {
  it('meta models read limits from their own record', () => {
    const limits = attachmentLimitsForModel('muse-spark-1.3')
    expect(limits.imageMaxBytes).toBe(MAX_IMAGE_BYTES)
    expect(limits.imageMaxCount).toBe(MODEL_API_MEDIA_PER_REQUEST)
    expect(limits.documentMaxBytes).toBe(MAX_DOCUMENT_BYTES)
    expect(limits.pdfMaxPages).toBe(MODEL_API_PDF_PAGE_IMAGES)
  })

  it('a model without a record is unknown: no legacy numbers stand in', () => {
    const limits = attachmentLimitsForModel('anthropic/claude-opus-4-6')
    expect(limits).toEqual({
      imageMaxBytes: undefined,
      imageMaxCount: undefined,
      documentMaxBytes: undefined,
      pdfMaxPages: undefined,
    })
  })

  it('a record stating only some limits leaves the rest unknown', () => {
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
    expect(limits.imageMaxCount).toBeUndefined()
    expect(limits.documentMaxBytes).toBeUndefined()
    expect(limits.pdfMaxPages).toBeUndefined()
  })

  it('the meta record states every enforced attachment limit', () => {
    const limits = attachmentLimitsForRecord(metaCapabilityRecord('muse-spark-1.3'))
    expect(limits.imageMaxBytes).toBe(MAX_IMAGE_BYTES)
    expect(limits.imageMaxCount).toBe(MODEL_API_MEDIA_PER_REQUEST)
    expect(limits.documentMaxBytes).toBe(MAX_DOCUMENT_BYTES)
    expect(limits.pdfMaxPages).toBe(MODEL_API_PDF_PAGE_IMAGES)
  })

  it('the request path uses the record’s own values, pinned equal', () => {
    expect(attachmentLimitsForModel('muse-spark-1.3')).toEqual(
      attachmentLimitsForRecord(metaCapabilityRecord('muse-spark-1.3')),
    )
  })
})

// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'
import type { AttachmentSummary } from '../../src/shared/protocol'
import { AttachmentChips } from '../../src/webview/components/AttachmentChips'

const clip: AttachmentSummary = {
  id: 'video',
  name: 'clip.mp4',
  mediaType: 'video/mp4',
  sizeBytes: 38_000_000,
  media: {
    info: {
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: 38_000_000,
      durationSeconds: 134,
      hasSoundtrack: true,
    },
    estimate: {
      estimatedInputTokens: 35_000,
      upperBoundInputTokens: 70_000,
      standardCostUsd: Usd.from(0.05).toAmount(),
      contributorCostUsd: Usd.from(0.02).toAmount(),
    },
  },
}

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('lazy media chip cost', () => {
  it('shows both positive U4 prices with two significant digits and ceilings the charge', async () => {
    const u4 = {
      ...clip,
      sizeBytes: 500_000,
      media: {
        info: { ...clip.media!.info, sizeBytes: 500_000, durationSeconds: 10 },
        estimate: {
          estimatedInputTokens: 2751,
          upperBoundInputTokens: 5502,
          standardCostUsd: Usd.from('0.00343875').toAmount(),
          contributorCostUsd: Usd.from('0.0002751').toAmount(),
        },
      },
    }
    render(<AttachmentChips attachments={[u4]} onRemove={vi.fn()} />)
    expect(await screen.findByText(/2,751 tokens \(est\.\)/)).toHaveTextContent(
      '10s · 500 kB · Sound · ~2,751 tokens (est.) · $0.0035 Standard / $0.00028 Contributor',
    )
    expect(screen.queryByText(/\$0\.00 Standard|\$0\.00 Contributor/)).not.toBeInTheDocument()
  })

  it('shows duration, bytes, sound and tokens marked as an estimate beside both prices', async () => {
    render(<AttachmentChips attachments={[clip]} onRemove={vi.fn()} isContributor />)
    expect(await screen.findByText(/35,000 tokens \(est\.\)/)).toHaveTextContent(
      '2m 14s · 38 MB · Sound · ~35,000 tokens (est.) · $0.05 Standard / $0.02 Contributor',
    )
    expect(screen.getByText(UI_TEXT.media.contributorWarning, { exact: false })).toBeInTheDocument()
  })

  it('warns about screen content every time, including Standard', async () => {
    const recording = { ...clip, media: { ...clip.media!, isScreenRecording: true } }
    render(<AttachmentChips attachments={[recording]} onRemove={vi.fn()} />)
    expect(
      await screen.findByText(UI_TEXT.media.recordingWarning, { exact: false }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(UI_TEXT.media.contributorWarning, { exact: false }),
    ).not.toBeInTheDocument()
  })

  it('keeps unknown duration and sound visible, and does not invent tokens or a price', async () => {
    const unknown = {
      ...clip,
      media: {
        info: {
          ...clip.media!.info,
          kind: 'video' as const,
          mediaType: 'video/mp4' as const,
          durationSeconds: null,
          hasSoundtrack: null,
        },
      },
    }
    render(<AttachmentChips attachments={[unknown]} onRemove={vi.fn()} />)
    expect(await screen.findByText(/Duration unknown/)).toHaveTextContent(
      'Duration unknown · 38 MB · Sound unknown',
    )
    expect(screen.queryByText(/tokens|Standard|Contributor/)).not.toBeInTheDocument()
  })

  it('formats localized numbers, durations, currency and labels at render time', async () => {
    setUiText(
      {
        ...EN,
        media: {
          ...EN.media,
          sound: 'Sonido',
          estimateTokens: { one: '{count} token (estim.)', other: '{count} tokens (estim.)' },
          estimatePrices: '{standard} Estándar / {contributor} Colaborador',
        },
      },
      'es',
    )
    render(<AttachmentChips attachments={[clip]} onRemove={vi.fn()} />)
    expect(await screen.findByText(/35\.000 tokens \(estim\.\)/)).toHaveTextContent('Sonido')
    expect(screen.getByText(/Estándar/)).toHaveTextContent('0,05')
  })

  it('keeps old image, PDF and text summaries and removal behavior unchanged', () => {
    const onRemove = vi.fn()
    const image = {
      id: 'i',
      name: 'test.png',
      mediaType: 'image/png',
      sizeBytes: 10,
      width: 2,
      height: 1,
    }
    const pdf = { id: 'p', name: 'test.pdf', mediaType: 'application/pdf', sizeBytes: 10 }
    const text = { id: 't', name: 'test.txt', mediaType: 'text/plain', sizeBytes: 10 }
    render(<AttachmentChips attachments={[image, pdf, text]} onRemove={onRemove} />)
    expect(screen.getByText('2×1')).toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.pdfLabel)).toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.textFileLabel)).toBeInTheDocument()
    expect(screen.queryByText(/\(est\.\)/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove test.png' }))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('i')
  })
})

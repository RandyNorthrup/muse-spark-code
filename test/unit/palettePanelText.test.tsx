// @vitest-environment jsdom
import { buildPalette } from '../../src/shared/paletteRegistry'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { PaletteContext } from '../../src/shared/palette'
import { Palette, type PaletteProps } from '../../src/webview/components/Palette'

const context: PaletteContext = {
  currentModel: { modelId: 'muse-spark-1.3', contextLimit: 1_007_997 },
  models: [
    {
      modelId: 'muse-spark-1.3',
      displayLabel: 'Muse Spark 1.3',
      contextLimit: 1_007_997,
      isDefault: false,
    },
    {
      modelId: 'muse-spark-1.3-contributor',
      displayLabel: 'Muse Spark 1.3 Contributor',
      contextLimit: 1_007_997,
      isDefault: false,
      trainsOnContent: true,
    },
  ],
  effort: 'high',
  isThinkingEnabled: true,
  permissionMode: 'manual',
  isFocusView: false,
  useCtrlEnterToSend: false,
  usage: undefined,
  skills: [
    {
      selector: 'manage-settings',
      displayName: 'Manage settings',
      description:
        'Any explicit Muse Code setting question or change requires a silent read_skill call.',
    },
  ],
  backend: 'museCode',
  paidFeatures: [],
  isKeyStored: false,
}

function propsFor(overrides: Partial<PaletteProps> = {}): PaletteProps {
  return {
    view: 'actions',
    groups: buildPalette(context),
    models: context.models,
    currentModelId: 'muse-spark-1.3',
    onAction: vi.fn(),
    onSelectModel: vi.fn(),
    onBack: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

function rowLabel(row: HTMLElement): string {
  return row.querySelector('.palette-item-label')?.textContent ?? ''
}

beforeEach(() => {
  setUiText(EN, 'en')
})

describe('panel plain words', () => {
  it('shows a person-facing line for Muse Code skills, never the model text', () => {
    render(<Palette {...propsFor()} />)
    const row = screen.getByRole('option', { name: /manage-settings/ })
    expect(row.textContent).toContain('/manage-settings')
    expect(row.textContent).toContain('Manage settings')
    expect(row.textContent).not.toContain('silent read_skill')
  })

  it('reads a duplicated description once', () => {
    render(<Palette {...propsFor()} />)
    // The resume row's tip repeats its detail up to a trailing period.
    const row = screen.getByRole('option', { name: /Resume/ })
    expect(row.textContent).toContain('Pick a previous conversation in this workspace')
    expect(row.hasAttribute('title')).toBe(false)
    expect(row.hasAttribute('aria-describedby')).toBe(false)
  })

  it('keeps a tip that says something of its own', () => {
    render(<Palette {...propsFor()} />)
    const row = screen.getByRole('option', { name: /Attach File/ })
    expect(row.hasAttribute('title')).toBe(true)
  })

  it('marks the contributor tier and leaves other models unmarked', () => {
    render(<Palette {...propsFor({ view: 'models' })} />)
    const rows = screen.getAllByRole('option')
    const contributor = rows.find((row) => rowLabel(row) === 'Muse Spark 1.3 Contributor')
    const standard = rows.find((row) => rowLabel(row) === 'Muse Spark 1.3')
    expect(contributor?.textContent).toContain('1M context · Contributor')
    expect(standard?.textContent).not.toContain('Contributor')
  })
})

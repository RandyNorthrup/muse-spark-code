// @vitest-environment jsdom
import { buildPalette } from '../../src/shared/paletteRegistry'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { type PaletteAction, type PaletteContext } from '../../src/shared/palette'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { Palette, type PaletteKeys, type PaletteProps } from '../../src/webview/components/Palette'

const context: PaletteContext = {
  currentModel: { modelId: 'muse-spark-1.3', contextLimit: 1_007_997 },
  models: [
    {
      modelId: 'muse-spark-1.3',
      displayLabel: 'Muse Spark 1.3',
      contextLimit: 1_007_997,
      isDefault: false,
    },
    { modelId: 'muse-spark-1.2', displayLabel: 'Muse Spark 1.2', isDefault: false },
  ],
  effort: 'high',
  isThinkingEnabled: true,
  permissionMode: 'manual',
  isFocusView: false,
  useCtrlEnterToSend: false,
  usage: undefined,
  skills: [{ selector: 'fix-bug', displayName: 'Fix bug', description: 'Fixes a bug' }],
  backend: 'museCode',
  paidFeatures: [],
  isKeyStored: false,
}

interface PaletteCalls {
  readonly actions: PaletteAction[]
  readonly selectedModels: string[]
  backs: number
  closes: number
  readonly activeRows: (string | undefined)[]
}

function paletteProps(overrides: Partial<PaletteProps> = {}): {
  readonly props: PaletteProps
  readonly calls: PaletteCalls
} {
  const calls: PaletteCalls = {
    actions: [],
    selectedModels: [],
    backs: 0,
    closes: 0,
    activeRows: [],
  }
  const { onActiveRowChange, ...rest } = overrides
  const props: PaletteProps = {
    view: 'actions',
    groups: buildPalette(context),
    models: context.models,
    currentModelId: 'muse-spark-1.3',
    onAction: (action) => {
      calls.actions.push(action)
    },
    onSelectModel: (modelId) => {
      calls.selectedModels.push(modelId)
    },
    onBack: () => {
      calls.backs += 1
    },
    onClose: () => {
      calls.closes += 1
    },
    onActiveRowChange: (elementId) => {
      calls.activeRows.push(elementId)
      onActiveRowChange?.(elementId)
    },
    ...rest,
  }
  return { props, calls }
}

function renderPalette(overrides: Partial<PaletteProps> = {}) {
  const { props, calls } = paletteProps(overrides)
  render(<Palette {...props} />)
  const filter = screen.getByRole('combobox')
  return { calls, filter }
}

const TIER_NAME = /^(Minimal|Low|Medium|High|Extra High|Max|Ultra)$/
const sliderDots = () => document.querySelectorAll('.palette-slider .slider-step')

function activeOption(): HTMLElement | undefined {
  return screen.getAllByRole('option').find((node) => node.getAttribute('aria-selected') === 'true')
}

describe('Palette (actions view)', () => {
  it('focuses the filter, lists the groups, and activates the first row on Enter', () => {
    const { calls, filter } = renderPalette()
    expect(document.activeElement).toBe(filter)
    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(activeOption()).toHaveTextContent('Attach File…')
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(calls.actions).toContainEqual({ type: 'attachFile' })
  })

  it('filters rows by text and reports no matches', () => {
    const { calls, filter } = renderPalette()
    fireEvent.change(filter, { target: { value: 'fix' } })
    expect(
      screen
        .getAllByRole('option')
        .map((node) => node.querySelector('.palette-item-text')?.textContent),
    ).toEqual(['/fix-bugFix bug'])
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(calls.actions).toContainEqual({ type: 'insertSkill', selector: 'fix-bug' })
    expect(filter).toHaveAttribute('aria-controls', 'palette-listbox')
    fireEvent.change(filter, { target: { value: 'nothing here' } })
    expect(screen.getByText('No matching actions')).toBeInTheDocument()
    // No list is shown, so the box controls none (a dangling reference fails WCAG 4.1.2).
    expect(filter).not.toHaveAttribute('aria-controls')
    expect(filter).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves with the arrow keys, wrapping at both ends', () => {
    const { filter } = renderPalette()
    const count = screen.getAllByRole('option').length
    fireEvent.keyDown(filter, { key: 'ArrowUp' })
    expect(activeOption()).toBe(screen.getAllByRole('option')[count - 1])
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    expect(activeOption()).toBe(screen.getAllByRole('option')[0])
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    expect(activeOption()).toHaveTextContent('Mention File From This Project…')
  })

  it('steps the effort slider with Left/Right, Enter and the step buttons', () => {
    const { calls, filter } = renderPalette()
    fireEvent.change(filter, { target: { value: 'effort' } })
    expect(activeOption()).toHaveTextContent('Effort (High)')
    fireEvent.keyDown(filter, { key: 'ArrowRight' })
    expect(calls.actions.at(-1)).toEqual({ type: 'setEffort', effort: 'xhigh' })
    fireEvent.keyDown(filter, { key: 'ArrowLeft' })
    expect(calls.actions.at(-1)).toEqual({ type: 'setEffort', effort: 'medium' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(calls.actions.at(-1)).toEqual({ type: 'setEffort', effort: 'xhigh' })
    fireEvent.click(screen.getByTitle('Max'))
    expect(calls.actions.at(-1)).toEqual({ type: 'setEffort', effort: 'max' })
    fireEvent.click(screen.getByTitle('Ultra'))
    expect(calls.actions.at(-1)).toEqual({ type: 'setEffort', effort: 'ultra' })
    // Every dot names its tier on hover, and only the model's tiers are offered.
    expect(sliderDots()).toHaveLength(7)
    expect(screen.getByTitle('High')).toHaveClass('slider-step-on')
    expect(screen.getByTitle('Extra High')).not.toHaveClass('slider-step-on')
    // Inside the row the dots are no controls of their own (M37): the row is.
    expect(screen.queryAllByRole('button', { name: TIER_NAME })).toEqual([])
    expect(document.querySelector('.palette-slider')).toHaveAttribute('aria-hidden', 'true')
  })

  it('offers only the tiers the current model serves', () => {
    renderPalette({
      groups: buildPalette({
        ...context,
        currentModel: { modelId: 'muse-spark-1.2', contextLimit: undefined },
      }),
    })
    expect(sliderDots()).toHaveLength(5)
    expect(screen.queryByTitle('Max')).toBeNull()
  })

  it('ignores Left/Right on ordinary rows and activates rows by click', () => {
    const { calls, filter } = renderPalette()
    fireEvent.keyDown(filter, { key: 'ArrowRight' })
    expect(calls.actions).toEqual([])
    fireEvent.click(screen.getByRole('option', { name: 'Clear Conversation' }))
    expect(calls.actions.at(-1)).toEqual({ type: 'clearConversation' })
  })

  it('shows toggles and values, and closes on Escape or blur', () => {
    const { calls, filter } = renderPalette()
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(screen.getByText('muse-spark-1.3 (1M context)')).toBeInTheDocument()
    fireEvent.keyDown(filter, { key: 'Escape' })
    expect(calls.closes).toBe(1)
    fireEvent.blur(filter)
    expect(calls.closes).toBe(2)
  })

  // M37: the list is a Tab stop so it scrolls from the keyboard; moving the
  // focus there must not close the palette the way leaving it does.
  it('stays open while the focus moves into the list, and closes on Escape from there', () => {
    const { calls, filter } = renderPalette()
    const list = document.querySelector<HTMLElement>('.palette-body')!
    expect(list).toHaveAttribute('tabindex', '0')
    expect(fireEvent.mouseDown(list)).toBe(false)
    fireEvent.blur(filter, { relatedTarget: list })
    expect(calls.closes).toBe(0)
    list.focus()
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(calls.closes).toBe(1)
    fireEvent.blur(list, { relatedTarget: document.body })
    expect(calls.closes).toBe(2)
  })

  it('leaves the loading skill note unselectable', () => {
    renderPalette({ groups: buildPalette({ ...context, skills: undefined }) })
    expect(screen.getByText('Start a conversation to load skills')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /load skills/ })).toBeNull()
    // A note carries no ARIA attribute, which would void its presentation role
    // and leave the listbox a child it may not hold (axe, aria-required-children).
    for (const note of document.querySelectorAll('.palette-item-disabled')) {
      expect(note.getAttributeNames().filter((name) => name.startsWith('aria-'))).toEqual([])
    }
  })
})

describe('Palette (models view)', () => {
  it('keeps the single bare Muse picker and its arrow wrapping unchanged', () => {
    const { calls, filter } = renderPalette({ view: 'models', models: context.models.slice(0, 1) })
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual([
      `Muse Spark 1.31M contextCurrent${UI_TEXT.paletteTips.switchModel}`,
    ])
    expect(screen.queryByText('Add a Model Provider…')).toBeNull()
    expect(screen.queryByText('Manage Models…')).toBeNull()
    fireEvent.keyDown(filter, { key: 'ArrowUp' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(calls.selectedModels).toHaveLength(2)
    expect(calls.selectedModels[0]).toBe('muse-spark-1.3')
    expect(calls.selectedModels[1]).toBe('muse-spark-1.3')
    expect(calls.actions).toEqual([])
  })

  it('lists models with their context window, marks the current one, and selects', () => {
    const { calls, filter } = renderPalette({ view: 'models' })
    const options = screen.getAllByRole('option')
    expect(options.map((node) => node.querySelector('.palette-item-text')?.textContent)).toEqual([
      'Muse Spark 1.31M context',
      'Muse Spark 1.2',
    ])
    expect(screen.getByTitle('Current')).toBeInTheDocument()
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(calls.selectedModels).toContain('muse-spark-1.2')
  })

  it('filters models and goes back on Escape or the back button', () => {
    const { calls, filter } = renderPalette({ view: 'models' })
    fireEvent.change(filter, { target: { value: '1.2' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(filter, { key: 'Escape' })
    expect(calls.backs).toBe(1)
    fireEvent.click(screen.getByLabelText('Back'))
    expect(calls.backs).toBe(2)
    // Escape from the list goes back too, not straight out.
    const list = document.querySelector<HTMLElement>('.palette-body')!
    list.focus()
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(calls.backs).toBe(3)
    expect(calls.closes).toBe(0)
  })

  it('groups by provider with pinned favourites first and the provider rows last', async () => {
    const { calls } = renderPalette({
      view: 'models',
      currentModelId: 'openrouter/deepseek/deepseek-v3',
      models: [
        {
          modelId: 'muse-spark-1.3',
          displayLabel: 'Muse Spark 1.3',
          contextLimit: 1_007_997,
          isDefault: false,
        },
        {
          modelId: 'openrouter/deepseek/deepseek-v3',
          displayLabel: 'DeepSeek V3',
          contextLimit: 64_000,
          isDefault: true,
          providerId: 'openrouter',
          providerLabel: 'OpenRouter',
          pricing: 'priced',
          inputUsdPerMTokens: 0.27,
          outputUsdPerMTokens: 1.1,
          isPinned: true,
        },
        {
          modelId: 'ollama/qwen3:8b',
          displayLabel: 'qwen3:8b',
          contextLimit: 32_768,
          isDefault: false,
          providerId: 'ollama',
          providerLabel: 'Ollama',
          pricing: 'local',
        },
      ],
    })
    // Priced rows read without prices until the lazy money chunk arrives.
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual([
      `DeepSeek V364K contextCurrent${UI_TEXT.paletteTips.switchModel}`,
      `Muse Spark 1.31M context${UI_TEXT.paletteTips.switchModel}`,
      `qwen3:8b32.8K context · Local${UI_TEXT.paletteTips.switchModel}`,
      'Add a Model Provider…',
      'Manage Models…',
    ])
    await screen.findByText(/\$0\.2700 in · \$1\.10 out/)
    const options = screen.getAllByRole('option')
    expect(options.map((node) => node.textContent)).toEqual([
      `DeepSeek V364K context · $0.2700 in · $1.10 out (per M tokens)Current${UI_TEXT.paletteTips.switchModel}`,
      `Muse Spark 1.31M context${UI_TEXT.paletteTips.switchModel}`,
      `qwen3:8b32.8K context · Local${UI_TEXT.paletteTips.switchModel}`,
      'Add a Model Provider…',
      'Manage Models…',
    ])
    expect(screen.getByText('Pinned Favourites')).toBeInTheDocument()
    expect(screen.getByText('Muse Spark')).toBeInTheDocument()
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Add a Model Provider…'))
    expect(calls.actions).toContainEqual({ type: 'addModelProvider' })
    fireEvent.click(screen.getByText('Manage Models…'))
    expect(calls.actions).toContainEqual({ type: 'manageModels' })
  })

  it('marks unpriced models and filters by provider', () => {
    const { filter } = renderPalette({
      view: 'models',
      models: [
        {
          modelId: 'openrouter/mystery/model',
          displayLabel: 'Mystery',
          isDefault: false,
          providerId: 'openrouter',
          providerLabel: 'OpenRouter',
          pricing: 'unpriced',
        },
      ],
    })
    expect(screen.getByRole('option', { name: /Mystery/ })).toHaveTextContent('Unpriced')
    fireEvent.change(filter, { target: { value: 'openrouter' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.change(filter, { target: { value: 'manage' } })
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual([
      'Manage Models…',
    ])
  })
})

// M38: shown by a "/" in the prompt, which keeps the focus and the keys.
describe('Palette (attached to the prompt)', () => {
  it('has no filter box, takes the prompt’s keys through its handle, and reports the active row', () => {
    const keys = createRef<PaletteKeys>()
    const { props, calls } = paletteProps({ isAttached: true, keys })
    render(
      <>
        <input
          aria-label="prompt"
          onKeyDown={(event) => {
            keys.current?.didHandleKey(event)
          }}
        />
        <Palette {...props} />
      </>,
    )
    const prompt = screen.getByLabelText('prompt')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Actions' })).toHaveClass('palette-attached')
    expect(calls.activeRows.at(-1)).toBe('palette-row-attachFile')
    // Its keys are taken and their defaults prevented; others pass through.
    expect(fireEvent.keyDown(prompt, { key: 'ArrowDown' })).toBe(false)
    expect(calls.activeRows.at(-1)).toBe('palette-row-mentionFile')
    expect(fireEvent.keyDown(prompt, { key: 'ArrowLeft' })).toBe(true)
    expect(fireEvent.keyDown(prompt, { key: 'x' })).toBe(true)
    fireEvent.keyDown(prompt, { key: 'Enter' })
    expect(calls.actions).toContainEqual({ type: 'mentionFile' })
    // The focus is the prompt's: leaving the list does not close it here.
    const list = document.querySelector<HTMLElement>('.palette-body')!
    fireEvent.blur(list, { relatedTarget: prompt })
    expect(calls.closes).toBe(0)
    fireEvent.keyDown(prompt, { key: 'Escape' })
    expect(calls.closes).toBe(1)
  })
})

describe('M87 palette descriptions', () => {
  it('reads a repeated description once, and keeps tips that say more', () => {
    renderPalette()
    const rows = screen.getAllByRole('option')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const describedby = row.getAttribute('aria-describedby')
      if (describedby === null) {
        // The tip repeated the visible detail, so it stays silent; the
        // detail itself still reads.
        expect(row.title).toBe('')
        expect(row.querySelector('.palette-item-detail')!.textContent.trim()).not.toBe('')
      } else {
        expect(document.querySelector(`[id="${CSS.escape(describedby)}"]`)).toHaveTextContent(
          row.title,
        )
        expect(row).toHaveAccessibleDescription(row.title)
      }
    }
    // Both kinds are on the board: repeated descriptions and real tips.
    expect(rows.some((row) => !row.hasAttribute('aria-describedby'))).toBe(true)
    expect(rows.some((row) => row.hasAttribute('aria-describedby'))).toBe(true)
  })

  it.each(['', ' '.repeat(3)])(
    'describes a skill with an empty or blank description: %j',
    (description) => {
      renderPalette({
        groups: buildPalette({
          ...context,
          // Not "review": M70's /review rows share that name.
          skills: [{ selector: 'tidy-notes', displayName: 'Tidy notes', description }],
        }),
      })
      const row = screen.getByRole('option', { name: /tidy-notes/ })
      expect(row).toHaveAttribute('title', 'Run the Tidy notes skill.')
      expect(row).toHaveAccessibleDescription('Run the Tidy notes skill.')
    },
  )
})

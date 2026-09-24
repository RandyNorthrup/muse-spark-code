// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { buildPalette, type PaletteAction, type PaletteContext } from '../../src/shared/palette'
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
}

function paletteProps(overrides: Partial<PaletteProps> = {}): PaletteProps {
  return {
    view: 'actions',
    groups: buildPalette(context),
    models: context.models,
    currentModelId: 'muse-spark-1.3',
    onAction: vi.fn<(action: PaletteAction) => void>(),
    onSelectModel: vi.fn(),
    onBack: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

function renderPalette(overrides: Partial<PaletteProps> = {}) {
  const props = paletteProps(overrides)
  render(<Palette {...props} />)
  const filter = screen.getByRole('combobox')
  return { props, filter }
}

const TIER_NAME = /^(Minimal|Low|Medium|High|Extra high|Max)$/
const sliderDots = () => document.querySelectorAll('.palette-slider .slider-step')

function activeOption(): HTMLElement | undefined {
  return screen.getAllByRole('option').find((node) => node.getAttribute('aria-selected') === 'true')
}

describe('Palette (actions view)', () => {
  it('focuses the filter, lists the groups, and activates the first row on Enter', () => {
    const { props, filter } = renderPalette()
    expect(document.activeElement).toBe(filter)
    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(activeOption()).toHaveTextContent('Attach file…')
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(props.onAction).toHaveBeenCalledWith({ type: 'attachFile' })
  })

  it('filters rows by text and reports no matches', () => {
    const { props, filter } = renderPalette()
    fireEvent.change(filter, { target: { value: 'fix' } })
    expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual([
      '/fix-bugFixes a bug',
    ])
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(props.onAction).toHaveBeenCalledWith({ type: 'insertSkill', selector: 'fix-bug' })
    fireEvent.change(filter, { target: { value: 'nothing here' } })
    expect(screen.getByText('No matching actions')).toBeInTheDocument()
  })

  it('moves with the arrow keys, wrapping at both ends', () => {
    const { filter } = renderPalette()
    const count = screen.getAllByRole('option').length
    fireEvent.keyDown(filter, { key: 'ArrowUp' })
    expect(activeOption()).toBe(screen.getAllByRole('option')[count - 1])
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    expect(activeOption()).toBe(screen.getAllByRole('option')[0])
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    expect(activeOption()).toHaveTextContent('Mention file from this project…')
  })

  it('steps the effort slider with Left/Right, Enter and the step buttons', () => {
    const { props, filter } = renderPalette()
    fireEvent.change(filter, { target: { value: 'effort' } })
    expect(activeOption()).toHaveTextContent('Effort (High)')
    fireEvent.keyDown(filter, { key: 'ArrowRight' })
    expect(props.onAction).toHaveBeenLastCalledWith({ type: 'setEffort', effort: 'xhigh' })
    fireEvent.keyDown(filter, { key: 'ArrowLeft' })
    expect(props.onAction).toHaveBeenLastCalledWith({ type: 'setEffort', effort: 'medium' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(props.onAction).toHaveBeenLastCalledWith({ type: 'setEffort', effort: 'xhigh' })
    fireEvent.click(screen.getByTitle('Max'))
    expect(props.onAction).toHaveBeenLastCalledWith({ type: 'setEffort', effort: 'max' })
    // Every dot names its tier on hover, and only the model's tiers are offered.
    expect(sliderDots()).toHaveLength(6)
    expect(screen.getByTitle('High')).toHaveClass('slider-step-on')
    expect(screen.getByTitle('Extra high')).not.toHaveClass('slider-step-on')
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
    const { props, filter } = renderPalette()
    fireEvent.keyDown(filter, { key: 'ArrowRight' })
    expect(props.onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: 'Clear conversation' }))
    expect(props.onAction).toHaveBeenLastCalledWith({ type: 'clearConversation' })
  })

  it('shows toggles and values, and closes on Escape or blur', () => {
    const { props, filter } = renderPalette()
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(screen.getByText('muse-spark-1.3 (1M context)')).toBeInTheDocument()
    fireEvent.keyDown(filter, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
    fireEvent.blur(filter)
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  // M37: the list is a Tab stop so it scrolls from the keyboard; moving the
  // focus there must not close the palette the way leaving it does.
  it('stays open while the focus moves into the list, and closes on Escape from there', () => {
    const { props, filter } = renderPalette()
    const list = document.querySelector<HTMLElement>('.palette-body')!
    expect(list).toHaveAttribute('tabindex', '0')
    expect(fireEvent.mouseDown(list)).toBe(false)
    fireEvent.blur(filter, { relatedTarget: list })
    expect(props.onClose).not.toHaveBeenCalled()
    list.focus()
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
    fireEvent.blur(list, { relatedTarget: document.body })
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('leaves the loading skill note unselectable', () => {
    renderPalette({ groups: buildPalette({ ...context, skills: undefined }) })
    expect(screen.getByText('Start a conversation to load skills')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /load skills/ })).toBeNull()
  })
})

describe('Palette (models view)', () => {
  it('lists models with their context window, marks the current one, and selects', () => {
    const { props, filter } = renderPalette({ view: 'models' })
    const options = screen.getAllByRole('option')
    expect(options.map((node) => node.textContent)).toEqual([
      'Muse Spark 1.31M contextCurrent',
      'Muse Spark 1.2',
    ])
    expect(screen.getByTitle('Current')).toBeInTheDocument()
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(props.onSelectModel).toHaveBeenCalledWith('muse-spark-1.2')
  })

  it('filters models and goes back on Escape or the back button', () => {
    const { props, filter } = renderPalette({ view: 'models' })
    fireEvent.change(filter, { target: { value: '1.2' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(filter, { key: 'Escape' })
    expect(props.onBack).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByLabelText('Back'))
    expect(props.onBack).toHaveBeenCalledTimes(2)
    // Escape from the list goes back too, not straight out.
    const list = document.querySelector<HTMLElement>('.palette-body')!
    list.focus()
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(props.onBack).toHaveBeenCalledTimes(3)
    expect(props.onClose).not.toHaveBeenCalled()
  })
})

// M38: shown by a "/" in the prompt, which keeps the focus and the keys.
describe('Palette (attached to the prompt)', () => {
  it('has no filter box, takes the prompt’s keys through its handle, and reports the active row', () => {
    const keys = createRef<PaletteKeys>()
    const onActiveRowChange = vi.fn<(elementId: string | undefined) => void>()
    const props = paletteProps({ isAttached: true, keys, onActiveRowChange })
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
    expect(onActiveRowChange).toHaveBeenLastCalledWith('palette-row-attachFile')
    // Its keys are taken and their defaults prevented; others pass through.
    expect(fireEvent.keyDown(prompt, { key: 'ArrowDown' })).toBe(false)
    expect(onActiveRowChange).toHaveBeenLastCalledWith('palette-row-mentionFile')
    expect(fireEvent.keyDown(prompt, { key: 'ArrowLeft' })).toBe(true)
    expect(fireEvent.keyDown(prompt, { key: 'x' })).toBe(true)
    fireEvent.keyDown(prompt, { key: 'Enter' })
    expect(props.onAction).toHaveBeenCalledWith({ type: 'mentionFile' })
    // The focus is the prompt's: leaving the list does not close it here.
    const list = document.querySelector<HTMLElement>('.palette-body')!
    fireEvent.blur(list, { relatedTarget: prompt })
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(prompt, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})

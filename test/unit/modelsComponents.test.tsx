import { Usd } from '../../src/shared/usd'
// @vitest-environment jsdom
// The panel's shared components: every state the plan names (empty,
// scanning, scan failed, form errors, test results, the table filtered,
// badges, suggestions, undo, import preview), and the keyboard paths
// through the dropdown and the table.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, plural } from '../../src/shared/l10n/text'
import { Badge } from '../../src/webview/models/components/Badge'
import { CostNotice } from '../../src/webview/models/components/CostNotice'
import { loadMoneyDisplay } from '../../src/webview/money'
import { DataTable, type DataTableProps } from '../../src/webview/models/components/DataTable'
import { FilterBar } from '../../src/webview/models/components/FilterBar'
import { InlineError } from '../../src/webview/models/components/InlineError'
import { KeyState } from '../../src/webview/models/components/KeyState'
import { ScanStatus } from '../../src/webview/models/components/ScanStatus'
import { SearchableSelect } from '../../src/webview/models/components/SearchableSelect'
import { SuggestionCard } from '../../src/webview/models/components/SuggestionCard'
import { UndoBar } from '../../src/webview/models/components/UndoBar'

describe('Badge', () => {
  it('shows each badge by its rule text', () => {
    const { rerender } = render(<Badge kind="recommended" />)
    expect(screen.getByText(UI_TEXT.modelBadges.recommended)).toBeDefined()
    rerender(<Badge kind="cheapestCapable" />)
    expect(screen.getByText(UI_TEXT.modelBadges.cheapestCapable)).toBeDefined()
    rerender(<Badge kind="largestContext" />)
    expect(screen.getByText(UI_TEXT.modelBadges.largestContext)).toBeDefined()
    rerender(<Badge kind="isNew" />)
    expect(screen.getByText(UI_TEXT.modelBadges.newBadge)).toBeDefined()
  })
})

describe('InlineError', () => {
  it('renders nothing without messages, one alert, or a list', () => {
    const { container, rerender } = render(<InlineError messages={[]} />)
    expect(container.textContent).toBe('')
    rerender(<InlineError messages={['Bad address']} />)
    expect(screen.getByRole('alert').textContent).toBe('Bad address')
    rerender(<InlineError messages={['First', 'Second']} />)
    const items = within(screen.getByRole('alert')).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['First', 'Second'])
  })
})

describe('KeyState', () => {
  it('names a missing key, a bound origin, or a moved file — never the key', () => {
    const { rerender } = render(<KeyState credential={{ state: 'missing' }} />)
    expect(screen.getByText(UI_TEXT.keyMissing)).toBeDefined()
    rerender(<KeyState credential={{ state: 'stored', origin: 'https://openrouter.ai' }} />)
    expect(
      screen.getByText(fill(UI_TEXT.keyBoundState, { origin: 'https://openrouter.ai' })),
    ).toBeDefined()
    rerender(
      <KeyState
        credential={{
          state: 'needs-again',
          origin: 'https://openrouter.ai',
          actualOrigin: 'https://example.com',
        }}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      fill(UI_TEXT.originBindingMismatch, {
        expected: 'https://openrouter.ai',
        actual: 'https://example.com',
      }),
    )
  })
})

describe('CostNotice', () => {
  it('asks before the paid check while the exact cost loads (STARTUP017)', async () => {
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    render(
      <CostNotice
        costUsd={Usd.from(0.000002).toAmount()}
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    )
    // Consent is given to a stated price (this file's first money load):
    // Accept waits for the cost line, while Cancel never waits.
    const accept = screen.getByRole('button', { name: UI_TEXT.suggestionAccept })
    expect(accept).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.loadingOutput)
    fireEvent.click(accept)
    expect(onAccept).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardCancel }))
    expect(onDecline).toHaveBeenCalledTimes(1)
    const money = await loadMoneyDisplay()
    expect(
      await screen.findByText(
        fill(UI_TEXT.providerTestPaid, {
          cost: money.formatTestCost(Usd.from(0.000002).toAmount()),
        }),
      ),
    ).toBeDefined()
    expect(accept).toBeEnabled()
    fireEvent.click(accept)
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('keeps a fraction of a cent readable', async () => {
    const money = await loadMoneyDisplay()
    expect(money.formatTestCost(Usd.from(0.000002).toAmount())).not.toBe(
      money.formatTestCost(Usd.from(0).toAmount()),
    )
    expect(money.formatTestCost(Usd.from(0.05).toAmount())).toContain('0.05')
  })
})

describe('UndoBar', () => {
  it('offers Undo per removal and stays silent otherwise', () => {
    const onUndo = vi.fn()
    const { container, rerender } = render(<UndoBar removals={[]} onUndo={onUndo} />)
    expect(container.textContent).toBe('')
    rerender(
      <UndoBar removals={[{ providerId: 'openrouter', label: 'OpenRouter' }]} onUndo={onUndo} />,
    )
    expect(screen.getByText(fill(UI_TEXT.providerRemoved, { id: 'openrouter' }))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.undoAction }))
    expect(onUndo).toHaveBeenCalledWith('openrouter')
  })
})

describe('ScanStatus', () => {
  it('asks for the first scan, reports a running one, and can cancel it', () => {
    const onRefresh = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <ScanStatus scan={undefined} onRefresh={onRefresh} onCancel={onCancel} />,
    )
    expect(screen.getByText(UI_TEXT.modelsNotScanned)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.refreshModels }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    rerender(
      <ScanStatus
        scan={{ providerId: 'ollama', status: 'scanning' }}
        onRefresh={onRefresh}
        onCancel={onCancel}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain(UI_TEXT.providersScanning)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardCancel }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('names a failed scan and diffs a finished one', () => {
    const noop = vi.fn()
    const { rerender } = render(
      <ScanStatus
        scan={{ providerId: 'ollama', status: 'failed', detail: 'connection refused' }}
        onRefresh={noop}
        onCancel={noop}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      fill(UI_TEXT.scanFailed, { detail: 'connection refused' }),
    )
    rerender(
      <ScanStatus
        scan={{
          providerId: 'ollama',
          status: 'done',
          newCount: 3,
          removedCount: 1,
          repricedCount: 0,
        }}
        onRefresh={noop}
        onCancel={noop}
      />,
    )
    expect(screen.getByText(plural(UI_TEXT.scanNewModels, 3))).toBeDefined()
    expect(screen.getByText(plural(UI_TEXT.scanRemovedModels, 1))).toBeDefined()
    expect(screen.queryByText(plural(UI_TEXT.scanRepricedModels, 0))).toBe(null)
  })
})

describe('SuggestionCard', () => {
  it('shows the value with its reason, and Accept or Change', () => {
    const onAccept = vi.fn()
    const onChange = vi.fn()
    render(
      <SuggestionCard
        title={UI_TEXT.suggestDefaultModel}
        reason="The cheapest model that calls tools."
        value="ollama/qwen3:8b"
        accepted={false}
        onAccept={onAccept}
        onChange={onChange}
      />,
    )
    expect(screen.getByText('ollama/qwen3:8b')).toBeDefined()
    expect(screen.getByText('The cheapest model that calls tools.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.suggestionAccept }))
    expect(onAccept).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.suggestionChange }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('disables Accept once accepted', () => {
    render(
      <SuggestionCard
        title={UI_TEXT.suggestSessionBudget}
        reason="From history."
        value="$2.00"
        accepted={true}
        onAccept={vi.fn()}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: UI_TEXT.suggestionAccept })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('never offers Accept for a value not yet stated (STARTUP017)', () => {
    const onAccept = vi.fn()
    const { rerender } = render(
      <SuggestionCard
        title={UI_TEXT.suggestSessionBudget}
        reason="From history."
        value=""
        isValueShown={false}
        accepted={false}
        onAccept={onAccept}
        onChange={vi.fn()}
      />,
    )
    const accept = screen.getByRole('button', { name: UI_TEXT.suggestionAccept })
    expect(accept).toBeDisabled()
    fireEvent.click(accept)
    expect(onAccept).not.toHaveBeenCalled()
    rerender(
      <SuggestionCard
        title={UI_TEXT.suggestSessionBudget}
        reason="From history."
        value="$2.00"
        isValueShown={true}
        accepted={false}
        onAccept={onAccept}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(accept)
    expect(onAccept).toHaveBeenCalledTimes(1)
  })
})

const SELECT_OPTIONS = [
  { value: 'openai', label: 'OpenAI', description: 'OpenAI Responses API', category: 'cloud' },
  { value: 'ollama', label: 'Ollama', description: 'Models on this computer', category: 'local' },
  { value: 'custom', label: 'Custom server', description: 'Your own endpoint', category: 'custom' },
]
const SELECT_CHIPS = [
  { value: 'cloud', label: 'Cloud' },
  { value: 'local', label: 'On this computer' },
]

function showSelect(onSelect: (value: string) => void = vi.fn()) {
  return render(
    <SearchableSelect
      label="Provider"
      placeholder="Search providers…"
      options={SELECT_OPTIONS}
      chips={SELECT_CHIPS}
      activeChip={undefined}
      onChip={vi.fn()}
      onSelect={onSelect}
    />,
  )
}

describe('SearchableSelect', () => {
  it('filters by name and description as it is typed', () => {
    showSelect()
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'computer' } })
    expect(screen.getByRole('option', { name: /Ollama/ })).toBeDefined()
    expect(screen.queryByRole('option', { name: /OpenAI/ })).toBe(null)
    fireEvent.change(box, { target: { value: 'no such provider' } })
    expect(screen.getByText(UI_TEXT.panelNoMatches)).toBeDefined()
  })

  it('walks with arrows and picks with Enter, and leaves with Escape', () => {
    const onSelect = vi.fn()
    showSelect(onSelect)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('ollama')
  })

  it('closes on Escape without picking', () => {
    const onSelect = vi.fn()
    showSelect(onSelect)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    expect(screen.getAllByRole('option').length).toBe(3)
    const activeId = box.getAttribute('aria-activedescendant')
    expect(activeId).not.toBeNull()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('option')).toBe(null)
    expect(box).not.toHaveAttribute('aria-activedescendant')
    expect(box).not.toHaveAttribute('aria-controls')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('clears active references on blur and when filtering removes all options', () => {
    showSelect()
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.change(box, { target: { value: 'no provider' } })
    expect(box).not.toHaveAttribute('aria-activedescendant')
    fireEvent.change(box, { target: { value: '' } })
    const activeId = box.getAttribute('aria-activedescendant')
    expect(screen.getAllByRole('option').some((option) => option.id === activeId)).toBe(true)
    fireEvent.blur(box)
    expect(box).not.toHaveAttribute('aria-activedescendant')
    expect(box).not.toHaveAttribute('aria-controls')
  })

  it('keeps the custom server under every chip', () => {
    const onChip = vi.fn()
    render(
      <SearchableSelect
        label="Provider"
        placeholder="Search providers…"
        options={SELECT_OPTIONS}
        chips={SELECT_CHIPS}
        activeChip="cloud"
        onChip={onChip}
        onSelect={vi.fn()}
      />,
    )
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: /OpenAI/ })).toBeDefined()
    expect(screen.getByRole('option', { name: /Custom server/ })).toBeDefined()
    expect(screen.queryByRole('option', { name: /Ollama/ })).toBe(null)
  })
})

describe('DataTable', () => {
  const columns = [
    { key: 'name', label: 'Model', sortable: true },
    { key: 'offered', label: 'Offered', sortable: false },
  ]
  const rows = [
    { id: 'b-model', label: 'b-model', cells: ['b-model', 'yes'] },
    { id: 'a-model', label: 'a-model', cells: ['a-model', 'no'] },
  ]

  function tableProps(onSort = vi.fn(), onRowActivate = vi.fn()): DataTableProps {
    return {
      caption: 'Models',
      columns,
      rows,
      sortKey: 'name',
      sortDirection: 'asc',
      emptyText: 'No matches.',
      onSort,
      onRowActivate,
    }
  }

  it('leaves Enter and arrow keys from child controls to those controls', () => {
    const onSort = vi.fn()
    const onRowActivate = vi.fn()
    render(<DataTable {...tableProps(onSort, onRowActivate)} />)
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    const header = screen.getByRole('button', { name: 'Model' })
    expect(fireEvent.keyDown(header, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(header, { key: 'ArrowDown' })).toBe(true)
    expect(onRowActivate).not.toHaveBeenCalled()
    fireEvent.click(header)
    expect(onSort).toHaveBeenCalledWith('name')
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(onRowActivate).toHaveBeenCalledWith('b-model')
  })

  it('clears the active descendant when filtering removes its row', () => {
    const onRowActivate = vi.fn()
    const currentProps = tableProps(vi.fn(), onRowActivate)
    const { rerender } = render(<DataTable {...currentProps} />)
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'End' })
    expect(grid).toHaveAttribute('aria-activedescendant', 'models-row-a-model')
    rerender(<DataTable {...currentProps} rows={rows.slice(0, 1)} />)
    expect(grid).not.toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(onRowActivate).not.toHaveBeenCalled()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(grid).toHaveAttribute('aria-activedescendant', 'models-row-b-model')
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(onRowActivate).toHaveBeenCalledWith('b-model')
  })

  it('sorts from its headers and activates rows from the keyboard', () => {
    const onSort = vi.fn()
    const onRowActivate = vi.fn()
    render(<DataTable {...tableProps(onSort, onRowActivate)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    expect(onSort).toHaveBeenCalledWith('name')
    const grid = screen.getByRole('grid')
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(onRowActivate).toHaveBeenCalledWith('b-model')
    fireEvent.keyDown(grid, { key: 'Escape' })
    fireEvent.keyDown(grid, { key: 'End' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(onRowActivate).toHaveBeenCalledWith('a-model')
  })

  it('names an empty table instead of an empty grid', () => {
    render(
      <DataTable
        caption="Models"
        columns={columns}
        rows={[]}
        sortKey={undefined}
        sortDirection="asc"
        emptyText="No matches."
        onSort={vi.fn()}
        onRowActivate={vi.fn()}
      />,
    )
    expect(screen.getByText('No matches.')).toBeDefined()
    expect(screen.queryByRole('grid')).toBe(null)
  })
})

describe('FilterBar', () => {
  it('toggles facets, types ranges, and clears', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    render(
      <FilterBar
        filter={{}}
        searchPlaceholder="Search models…"
        providers={['ollama']}
        families={['qwen3']}
        onChange={onChange}
        onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.modelFilterLabels.toolCalling }))
    expect(onChange).toHaveBeenCalledWith({ toolCalling: true })
    fireEvent.change(screen.getByPlaceholderText('Search models…'), { target: { value: 'qwen' } })
    expect(onChange).toHaveBeenCalledWith({ search: 'qwen' })
    fireEvent.change(screen.getByLabelText(UI_TEXT.modelFilterLabels.contextMin), {
      target: { value: '32000' },
    })
    expect(onChange).toHaveBeenCalledWith({ contextMin: 32_000 })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.modelFilterLabels.clear }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

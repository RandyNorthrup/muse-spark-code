// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodeBlock } from '../../src/webview/components/CodeBlock'

const held = vi.hoisted(() => ({ load: Promise.withResolvers<undefined>(), loads: 0 }))
vi.mock('../../src/webview/components/HighlightedCode', async (original) => {
  held.loads += 1
  await held.load.promise
  return await original()
})

describe('code while its highlighting chunk loads', () => {
  it('keeps open/unknown fences immediate, loads on demand, and preserves text and actions', async () => {
    const onCopy = vi.fn()
    const onInsert = vi.fn()
    const onApply = vi.fn()
    const actions = { onCopy, onInsert, onApply }
    const { rerender } = render(
      <CodeBlock code={'<script>open</script>'} language="ts" isOpen {...actions} />,
    )
    expect(held.loads).toBe(0)
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText('<script>open</script>')).toBeInTheDocument()
    rerender(<CodeBlock code="unknown" language="no-grammar" {...actions} />)
    expect(held.loads).toBe(0)

    rerender(<CodeBlock code={'const old = "<script>"'} language="TS" {...actions} />)
    await waitFor(() => {
      expect(held.loads).toBe(1)
    })
    expect(screen.getByText('typescript')).toBeInTheDocument()
    expect(document.querySelector('.hljs-keyword')).toBeNull()
    expect(screen.getByText('const old = "<script>"')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('pre')).toHaveAttribute('tabindex', '0')

    const latest = 'const latest = "<img src=x onerror=alert(1)>"'
    rerender(<CodeBlock code={latest} language="ts" {...actions} />)
    fireEvent.click(screen.getByText('Copy'))
    fireEvent.click(screen.getByText('Insert at cursor'))
    fireEvent.click(screen.getByText('Apply'))
    expect(onCopy).toHaveBeenLastCalledWith(latest)
    expect(onInsert).toHaveBeenLastCalledWith(latest)
    expect(onApply).toHaveBeenLastCalledWith(latest)

    await act(async () => {
      held.load.resolve(undefined)
      await held.load.promise
    })
    await screen.findByText('const', { selector: '.hljs-keyword' })
    expect(document.querySelector('pre')?.textContent).toBe(latest)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.queryByText('const old = "<script>"')).toBeNull()
    rerender(<CodeBlock code="streaming again" language="ts" isOpen {...actions} />)
    expect(screen.getByText('streaming again')).toBeInTheDocument()
    expect(document.querySelector('.hljs-keyword')).toBeNull()
    expect(held.loads).toBe(1)
  })
})

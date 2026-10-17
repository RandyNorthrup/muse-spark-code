// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { MODEL_SECTIONS } from '../../src/webview/models/sections'
import { retrySurface } from '../../src/webview/surfaceRetry'
import { makeState } from './modelsPanelFixtures'

vi.mock('../../src/webview/models/ModelsSection', () => {
  throw new Error('private chunk failure')
})
vi.mock('../../src/webview/surfaceRetry', () => ({ retrySurface: vi.fn() }))

it('contains a Models chunk failure and offers an accessible retry without private detail', async () => {
  const Section = MODEL_SECTIONS.find((section) => section.id === 'models')?.Component
  if (Section === undefined) throw new Error('Missing Models section')
  render(
    <Section
      panelState={makeState()}
      post={vi.fn()}
      navigate={vi.fn()}
      dispatch={vi.fn()}
      wizardOpen={false}
      wizardLife={{ generation: 1, isCurrent: () => true }}
      importOpen={false}
      highlightedItem={undefined}
    />,
  )
  expect(screen.getByRole('status').textContent).toBe(UI_TEXT.loadingOutput)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(UI_TEXT.surfaceLoadFailed)
  expect(document.body.textContent).not.toContain('private chunk failure')
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry }))
  expect(retrySurface).toHaveBeenCalledOnce()
})

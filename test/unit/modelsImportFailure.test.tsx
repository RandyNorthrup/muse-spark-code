// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { ProvidersSection } from '../../src/webview/models/ProvidersSection'
import { makeState } from './modelsPanelFixtures'

vi.mock('../../src/webview/models/ImportPane', () => {
  throw new Error('fixture chunk unavailable')
})

it('failed import chunk keeps its section label, alert, retry and close controls', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  render(
    <ProvidersSection
      panelState={makeState()}
      post={vi.fn()}
      navigate={vi.fn()}
      dispatch={vi.fn()}
      wizardOpen={false}
      wizardLife={{ generation: 0, isCurrent: () => false }}
      importOpen
      highlightedItem={undefined}
    />,
  )
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(UI_TEXT.providerImport)
  expect(alert).toHaveTextContent(UI_TEXT.surfaceLoadFailed)
  expect(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry })).toBeVisible()
  expect(screen.getByRole('button', { name: UI_TEXT.usageClose })).toBeVisible()
})

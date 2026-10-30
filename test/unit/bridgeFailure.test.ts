// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { showBridgeFailure } from '../../src/webview/bridges/failure'
import { UI_TEXT } from '../../src/shared/l10n/text'
import ES from '../../l10n/ui.es.json'

afterEach(() => {
  document.body.replaceChildren()
})
it('shows a single focused localized alert and prevents commands on a disconnected surface', () => {
  const composer = document.createElement('div')
  composer.innerHTML = '<button>Send</button>'
  document.body.append(composer)
  showBridgeFailure(document)
  showBridgeFailure(document)
  expect(composer.inert).toBe(true)
  const alert = document.querySelector('[role="alert"]')
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
  expect(alert?.textContent).toContain(UI_TEXT.companionLaunchFailed)
  expect(document.activeElement).toBe(alert)
})

it('installs the embedded language before a carrier fails during startup', () => {
  const table = document.createElement('script')
  table.id = 'muse-l10n'
  table.type = 'application/json'
  table.textContent = JSON.stringify({ locale: 'es', table: ES })
  document.body.append(table)
  showBridgeFailure(document)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(ES.companionLaunchFailed)
})

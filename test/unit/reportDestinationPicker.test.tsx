/** @vitest-environment jsdom */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import {
  DestinationPicker,
  type DestinationPickerProps,
} from '../../src/webview/reporting/destinations/DestinationPicker'
import { UI_TEXT } from '../../src/shared/constants'
import { ADDRESS, CONNECTION, reportAction } from './helpers/reporting/destinations'

afterEach(cleanup)
function props(): DestinationPickerProps {
  const destinations = reportAction([
    {
      type: 'save',
      id: 'save',
      root: 'C:/reports',
      storage: 'local',
      template: '{kind}-{date}.{ext}',
      retention: 30,
    },
    { type: 'browser', id: 'browser', storage: 'node' },
    { type: 'email', id: 'email', address: ADDRESS, connection: CONNECTION },
    {
      type: 'post',
      id: 'post',
      target: { repository: 'owner/project', number: 12, kind: 'issueComment' },
    },
  ]).destinations
  return {
    destinations,
    choices: destinations,
    format: 'md',
    connections: [CONNECTION],
    verifiedRecipients: [],
    connectableProviders: ['gmail', 'outlook'],
    onChange: vi.fn(),
    onFormat: vi.fn(),
    onPickFolder: vi.fn(),
    onConnect: vi.fn(),
    onVerify: vi.fn(),
  }
}
describe('shared lazy report destination picker', () => {
  it('selects/removes destinations and delegates native folder and OAuth clicks', () => {
    const input = props()
    render(<DestinationPicker {...input} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.reportUi.saveDestination }))
    expect(input.onPickFolder).toHaveBeenCalledWith('save')
    fireEvent.click(
      screen.getByRole('button', { name: `${UI_TEXT.reportLabels.provider} (Gmail)` }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: `${UI_TEXT.reportLabels.provider} (Outlook)` }),
    )
    expect(input.onConnect).toHaveBeenCalledWith('gmail')
    expect(input.onConnect).toHaveBeenCalledWith('outlook')
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: `${UI_TEXT.reportUi.browserDestination}: node (browser)`,
      }),
    )
    expect(input.onChange).toHaveBeenCalledWith(
      input.destinations.filter((item) => item.type !== 'browser'),
    )
    expect(screen.getByText(UI_TEXT.reportUi.openWhenBack)).toBeTruthy()
  })
  it('edits formats, names, retention and recipients without touching credentials', () => {
    const input = props()
    render(<DestinationPicker {...input} />)
    fireEvent.change(screen.getByLabelText(UI_TEXT.reportUi.format), { target: { value: 'html' } })
    expect(input.onFormat).toHaveBeenCalledWith('html')
    fireEvent.change(screen.getByLabelText(UI_TEXT.reportUi.nameTemplate), {
      target: { value: '{kind}-{hash8}.{ext}' },
    })
    expect(input.onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ template: '{kind}-{hash8}.{ext}' })]),
    )
    fireEvent.change(screen.getByLabelText(UI_TEXT.reportUi.retention), { target: { value: '7' } })
    expect(input.onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ retention: 7 })]),
    )
    expect(screen.getByText(UI_TEXT.reportUi.recipientUnverified).getAttribute('role')).toBe(
      'status',
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.reportUi.verifyRecipient }))
    expect(input.onVerify).toHaveBeenCalledWith('email')
  })
  it('has named fields and groups and passes axe structural checks', async () => {
    const { container } = render(<DestinationPicker {...props()} />)
    // Real-browser contrast/theme/320px checks are recorded separately. jsdom
    // supplies no layout and axe cannot evaluate contrast without canvas.
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations).toEqual([])
  })
  it('wraps long destination identities in labels and legends', async () => {
    // jsdom supplies no layout, so this pins the stylesheet rule that the
    // 320 px browser check measures: labels and legends wrap anywhere.
    const css = await readFile(
      path.resolve(
        import.meta.dirname,
        '../../src/webview/reporting/destinations/destinations.css',
      ),
      'utf8',
    )
    for (const selector of ['label', 'legend']) {
      const isWrapping = css
        .split('}')
        .some(
          (rule) =>
            rule.includes(selector) && /overflow-wrap\s*:\s*(anywhere|break-word)/.test(rule),
        )
      expect(isWrapping, selector).toBe(true)
    }
  })
  it('names each configured target visibly and accessibly before selection', () => {
    const input = props()
    const choices = [
      ...input.choices,
      {
        type: 'post' as const,
        id: 'issue-13',
        target: { repository: 'owner/project', number: 13, kind: 'issueComment' as const },
      },
      { type: 'browser' as const, id: 'local-browser', storage: 'local' as const },
      {
        type: 'save' as const,
        id: 'archive',
        root: 'C:/archive',
        storage: 'local' as const,
        template: '{kind}.{ext}',
        retention: 30,
      },
      {
        type: 'email' as const,
        id: 'other-email',
        address: 'other@example.test',
        connection: CONNECTION,
      },
    ]
    render(<DestinationPicker {...input} choices={choices} destinations={[]} />)
    for (const detail of [
      'owner/project #12 (post)',
      'owner/project #13 (issue-13)',
      'node (browser)',
      'local (local-browser)',
      'C:/reports (save)',
      'C:/archive (archive)',
      `${ADDRESS} (email)`,
      'other@example.test (other-email)',
    ]) {
      const checkbox = screen.getByRole('checkbox', {
        name: new RegExp(detail.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)),
      })
      expect(checkbox.closest('label')?.textContent).toContain(detail)
    }
  })
})

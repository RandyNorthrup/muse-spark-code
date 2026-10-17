// @vitest-environment jsdom
// What's New's page script (M99, PLAN.md D79): it passes a link's and a Try
// it's index and the toggle's state back to the host, and nothing else.

import { describe, expect, it, vi } from 'vitest'
import type { WhatsNewMessage } from '../../src/shared/whatsNewMessages'
import { wireWhatsNewPage } from '../../src/webview/whatsNew/whatsNewPage'

/** A page of its own, wired, and what it sent. */
function setUp() {
  const page = document.implementation.createHTMLDocument('What’s New')
  page.body.innerHTML = `
    <p><a href="https://example.com/" data-link="2"><code>inside</code></a></p>
    <p><a href="https://example.com/odd" data-link="x">odd</a></p>
    <button type="button" data-try="1">Try it</button>
    <button type="button">Other</button>
    <label><input type="checkbox" id="hide-on-update"> Don't show</label>`
  const post = vi.fn<(message: WhatsNewMessage) => void>()
  wireWhatsNewPage(page, post)
  return { page, post }
}

describe('wireWhatsNewPage', () => {
  it('sends a link’s index in place of following it, from a click inside it too', () => {
    const { page, post } = setUp()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    page.querySelector('code')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: 'openLink', index: 2 })
  })

  it('never follows a link it cannot index, and sends nothing for it', () => {
    const { page, post } = setUp()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    page.querySelector('a[data-link="x"]')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(post).not.toHaveBeenCalled()
  })

  it('sends a Try it’s index, and nothing for another button or the page', () => {
    const { page, post } = setUp()
    page.querySelector<HTMLButtonElement>('button[data-try]')?.click()
    page.querySelector<HTMLButtonElement>('button:not([data-try])')?.click()
    page.body.click()
    expect(post.mock.calls).toEqual([[{ type: 'tryIt', index: 1 }]])
  })

  it('sends the toggle’s state', () => {
    const { page, post } = setUp()
    const toggle = page.querySelector<HTMLInputElement>('#hide-on-update')
    toggle?.click()
    toggle?.click()
    expect(post.mock.calls).toEqual([
      [{ type: 'hideOnUpdate', isHidden: true }],
      [{ type: 'hideOnUpdate', isHidden: false }],
    ])
  })
})

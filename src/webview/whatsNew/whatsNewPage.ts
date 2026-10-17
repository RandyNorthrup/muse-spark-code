// What's New's page script (M99, PLAN.md D79). The host renders the whole
// page; this only passes the reader's clicks back: a link's index (the host
// opens its own copy of the address), a Try it's index (the host runs only
// an entry of the list it rendered) and the "Don't show on updates" toggle.
// A link is a real `<a href>` for keyboards and screen readers; its default
// navigation is replaced by the message.

import type { WhatsNewMessage } from '../../shared/whatsNewMessages'
import {
  WHATS_NEW_LINK_ATTRIBUTE,
  WHATS_NEW_LINK_SELECTOR,
  WHATS_NEW_TOGGLE_SELECTOR,
  WHATS_NEW_TRY_ATTRIBUTE,
  WHATS_NEW_TRY_SELECTOR,
} from '../../shared/whatsNewPage'

const DIGITS = /^\d+$/

function indexOf(element: Element, attribute: string): number | undefined {
  const value = element.getAttribute(attribute)
  return value !== null && DIGITS.test(value) ? Number(value) : undefined
}

/** Starts passing the page's clicks to `post`. */
export function wireWhatsNewPage(page: Document, post: (message: WhatsNewMessage) => void): void {
  page.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
      return
    }
    const link = event.target.closest(WHATS_NEW_LINK_SELECTOR)
    if (link !== null) {
      event.preventDefault()
      const index = indexOf(link, WHATS_NEW_LINK_ATTRIBUTE)
      if (index !== undefined) {
        post({ type: 'openLink', index })
      }
      return
    }
    const button = event.target.closest(WHATS_NEW_TRY_SELECTOR)
    const index = button === null ? undefined : indexOf(button, WHATS_NEW_TRY_ATTRIBUTE)
    if (index !== undefined) {
      post({ type: 'tryIt', index })
    }
  })
  const toggle = page.querySelector(WHATS_NEW_TOGGLE_SELECTOR)
  if (toggle instanceof HTMLInputElement) {
    toggle.addEventListener('change', () => {
      post({ type: 'hideOnUpdate', isHidden: toggle.checked })
    })
  }
}

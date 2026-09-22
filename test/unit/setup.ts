import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Testing Library only auto-unmounts when vitest exposes globals; this project
// keeps globals off, so unmount explicitly or renders leak across tests.
afterEach(() => {
  cleanup()
})

// jsdom does not implement scrollIntoView; the palette calls it on the
// active row, and the tests only care that the row is marked active.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {
    // no layout in jsdom
  }
}

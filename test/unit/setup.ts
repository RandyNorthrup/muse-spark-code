import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Testing Library only auto-unmounts when vitest exposes globals; this project
// keeps globals off, so unmount explicitly or renders leak across tests.
afterEach(() => {
  cleanup()
})

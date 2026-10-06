import { defineConfig } from 'vitest/config'
import base from '../../../vitest.config.ts'

// A owns central discovery. This lane-local config preserves its other settings/deadlines.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/m104/windows/**/*.test.mjs', 'test/unit/vscodeHostServices.test.ts'],
  },
})

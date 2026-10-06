import { defineConfig } from 'vitest/config'

// Container integration is mandatory in node-image CI, separate from unit
// gates on machines that do not run a container engine.
export default defineConfig({
  test: { include: ['test/node-image/*.test.mjs'], environment: 'node' },
})

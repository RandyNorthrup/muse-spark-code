import base from '../../../vitest.config.ts'

export default {
  ...base,
  test: { ...base.test, include: ['test/m104/mac/**/*.test.mjs'] },
}

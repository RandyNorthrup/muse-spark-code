import base from '../../vitest.config.ts'

export default {
  ...base,
  test: {
    ...base.test,
    include: [
      'test/hostApi/**/*.test.mjs',
      'test/unit/mhpContract.test.ts',
      'test/unit/mhpPanelContract.test.ts',
    ],
  },
}

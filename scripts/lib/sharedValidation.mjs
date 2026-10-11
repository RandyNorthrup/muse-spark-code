/** @type {import('esbuild').Plugin} */
export const sharedValidation = {
  name: 'shared-validation',
  setup(build) {
    build.onResolve({ filter: /^zod\/mini$/ }, () => ({
      path: './validation.js',
      external: true,
    }))
  },
}

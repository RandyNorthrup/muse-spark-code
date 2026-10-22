import { readFileSync } from 'node:fs'
import path from 'node:path'

// Keep maker-only Zod helpers behind the second maker import. Otherwise esbuild
// coalesces them with chat's eagerly loaded Zod module and grows startup.
export const isolateMakerValidation = {
  name: 'maker-validation',
  setup(build) {
    build.onResolve({ filter: /^zod\/mini$/ }, async (args) => {
      if (!/[/\\]shared[/\\]makerProtocol(?:Preview)?\.ts$/.test(args.importer)) return
      const result = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
      })
      return { ...result, namespace: 'maker-validation' }
    })
    build.onResolve({ filter: /.*/, namespace: 'maker-validation' }, async (args) => {
      const result = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
      })
      return { ...result, namespace: 'maker-validation' }
    })
    build.onLoad({ filter: /.*/, namespace: 'maker-validation' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'js',
      resolveDir: path.dirname(args.path),
    }))
  },
}

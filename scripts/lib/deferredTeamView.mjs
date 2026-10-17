import path from 'node:path'

export { deferredCohort } from './deferredBundles.mjs'

// Node keeps only lazy schema proxies; the browser keeps its synchronous validators.
/** @type {import('esbuild').Plugin} */
export const deferredTeamView = {
  name: 'deferred-team-view',
  setup(build) {
    build.onResolve({ filter: /\/teamView(?:\.[jt]s)?$/ }, (args) => {
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      return source === path.resolve('src/shared/teamView.ts')
        ? { path: path.resolve('src/host/teamViewBundle.ts') }
        : undefined
    })
    build.onResolve({ filter: /\/teamEntry(?:\.[jt]s)?$/ }, (args) =>
      args.kind === 'require-call' || args.kind === 'dynamic-import'
        ? { path: './team.js', external: true }
        : undefined,
    )
  },
}

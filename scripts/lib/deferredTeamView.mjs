import path from 'node:path'

const entries = new Map([
  [path.resolve('src/core/team/teamSchedulerEntry.ts'), './teamScheduler.js'],
  [path.resolve('src/host/runners/teamRunnersEntry.ts'), './teamRunners.js'],
  [path.resolve('src/host/sessionBoardEntry.ts'), './sessionBoard.js'],
  [path.resolve('src/core/backends/modelapi/reviewerEntry.ts'), './reviewer.js'],
  [path.resolve('src/core/team/teamEntry.ts'), './team.js'],
])

/** Keep production imports dynamic; tests use the identical resolver. */
/** @type {import('esbuild').Plugin} */
export const deferredCohort = {
  name: 'deferred-cohort',
  setup(build) {
    build.onResolve(
      {
        filter:
          /\/(?:sessionBoardEntry|reviewerEntry|teamEntry|teamRunnersEntry|teamSchedulerEntry)(?:\.[jt]s)?$/,
      },
      (args) => {
        if (args.kind !== 'dynamic-import') return
        const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
        const output = entries.get(source)
        return output === undefined ? undefined : { path: output, external: true }
      },
    )
  },
}

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

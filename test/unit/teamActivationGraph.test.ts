import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { deferredCohort, sharedWire } from '../../scripts/lib/deferredBundles.mjs'
import { deferredTeamView } from '../../scripts/lib/deferredTeamView.mjs'

it('ordinary activation, backend and ACP graphs have no team runtime modules', async () => {
  const result = await build({
    entryPoints: ['src/extension.ts', 'src/host/backend/modelApiEntry.ts', 'src/runtime/main.ts'],
    bundle: true,
    platform: 'node',
    outdir: 'activation-graph-check',
    write: false,
    metafile: true,
    external: ['vscode', '@napi-rs/keyring'],
    plugins: [deferredCohort, sharedWire, deferredTeamView],
    logLevel: 'silent',
  })
  expect(
    Object.keys(result.metafile.inputs).filter((name) =>
      /^src\/(core|host)\/(?:team|runners)\//.test(name),
    ),
  ).toEqual([])
})

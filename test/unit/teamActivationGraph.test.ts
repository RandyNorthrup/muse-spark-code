import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('ordinary activation, backend and ACP graphs have no team runtime modules', async () => {
  const result = await build({
    entryPoints: ['src/extension.ts', 'src/host/backend/modelApiEntry.ts', 'src/runtime/main.ts'],
    bundle: true,
    platform: 'node',
    outdir: 'activation-graph-check',
    write: false,
    metafile: true,
    external: ['vscode', '@napi-rs/keyring'],
    plugins: [
      {
        name: 'deferred-team',
        setup(bundle) {
          bundle.onResolve({ filter: /\/teamEntry(?:\.[jt]s)?$/ }, (args) =>
            args.kind === 'dynamic-import' ? { path: './team.js', external: true } : undefined,
          )
        },
      },
    ],
    logLevel: 'silent',
  })
  expect(
    Object.keys(result.metafile.inputs).filter((name) => /^src\/(core|host)\/team\//.test(name)),
  ).toEqual([])
})

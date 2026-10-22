// Stages the freshly bundled ACP agent (`src/runtime/main.ts`) plus its
// version and localization tables into a folder, ready to spawn over
// stdio. Both the live drills and the handshake proof stage the same
// artifact; one helper keeps the two stagings identical.
import { cp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'

/** Bundle the agent into `<directory>/dist/acp.js` with its tables; returns the agent path. */
export async function stageAgentBundle(directory: string): Promise<string> {
  const agent = path.join(directory, 'dist', 'acp.js')
  await build({
    entryPoints: [path.resolve('src', 'runtime', 'main.ts')],
    outfile: agent,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '0.0.0-test' }))
  await cp(path.resolve('l10n'), path.join(directory, 'l10n'), { recursive: true })
  return agent
}

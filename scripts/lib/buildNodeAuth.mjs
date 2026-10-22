// A1's separate lazy artifacts; existing activation/node/webview caps stay unchanged.
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { sharedUiText } from './deferredBundles.mjs'
import { loadL10n } from './l10nSource.mjs'
import { checkNodeAuthArtifact, checkNodeAuthSplit, nodeAuthNotices } from './nodeAuthArtifacts.mjs'

const pageEnglish = {
  name: 'node-auth-english',
  setup(build) {
    build.onLoad({ filter: /[/\\]l10n[/\\]en\.ts$/ }, async (args) => {
      const { EN } = await loadL10n(process.cwd())
      const entries = Object.fromEntries(
        Object.entries(EN).filter(([key]) => key.startsWith('node')),
      )
      return {
        contents: `export const EN = ${JSON.stringify(entries)}`,
        loader: 'js',
        watchFiles: [args.path],
      }
    })
  },
}
const OUTPUTS = [
  {
    entry: 'src/runtime/node/auth/entry.ts',
    output: 'dist/nodeAuth.js',
    platform: 'node',
    format: 'cjs',
    budgetKiB: 500,
    plugins: [sharedUiText],
  },
  {
    entry: 'src/webview/node/auth/entry.tsx',
    output: 'dist/nodeAuthPage.js',
    platform: 'browser',
    format: 'iife',
    budgetKiB: 350,
    plugins: [pageEnglish],
  },
]
const normalize = (file) => file.replaceAll('\\', '/')
const BYTES_PER_KIB = 1024

export async function buildNodeAuth() {
  const sizes = []
  const metafiles = []
  for (const artifact of OUTPUTS) {
    const result = await esbuild.build({
      entryPoints: [artifact.entry],
      outfile: artifact.output,
      bundle: true,
      minify: true,
      sourcemap: false,
      metafile: true,
      write: false,
      platform: artifact.platform,
      format: artifact.format,
      target: 'es2023',
      nodePaths: process.env['NODE_PATH']?.split(path.delimiter) ?? [],
      plugins: artifact.plugins,
      ...(artifact.platform === 'browser' && { globalName: 'MuseNodeAuth', jsx: 'automatic' }),
    })
    const output = result.outputFiles.find((file) => normalize(file.path).endsWith(artifact.output))
    if (output === undefined) throw new Error(`Missing ${artifact.output}`)
    const sizeKiB =
      result.outputFiles.reduce((total, file) => total + file.contents.length, 0) / BYTES_PER_KIB
    checkNodeAuthArtifact(artifact, sizeKiB, Object.keys(result.metafile.inputs))
    metafiles.push(result.metafile)
    await mkdir('dist/meta-node-auth', { recursive: true })
    for (const file of result.outputFiles) await writeFile(file.path, file.contents)
    await writeFile(
      `dist/meta-node-auth/${path.basename(artifact.output, '.js')}.json`,
      JSON.stringify(result.metafile, null, 2),
    )
    sizes.push({ file: artifact.output, sizeKiB, budgetKiB: artifact.budgetKiB })
  }
  for (const meta of [
    'dist/meta/extension.json',
    'dist/meta-acp/acp.json',
    'dist/meta-acp/node.json',
    'dist/meta/webview.json',
  ]) {
    let text
    try {
      text = await readFile(meta, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    const parsed = JSON.parse(text)
    checkNodeAuthSplit(Object.keys(parsed.inputs), meta)
  }
  await writeFile('dist/NODE_AUTH_NOTICES.txt', await nodeAuthNotices(metafiles))
  return sizes
}

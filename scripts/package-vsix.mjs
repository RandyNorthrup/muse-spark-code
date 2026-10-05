// Stage only VSCE's allowlisted files, compact JSON without changing its
// values, and package short landing docs. Source docs and tables stay readable.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import { loadL10n } from './lib/l10nSource.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listFiles, pack } from '@vscode/vsce/out/package.js'

const RECENT_RELEASES = 2
const HISTORY = 'https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md'
const COMPACT_JSON =
  /^(?:l10n\/ui\.[^/]+\.json|package(?:\.nls(?:\.[^/]+)?)?\.json|dist\/whatsNew\.json)$/

export function packagedChangelog(text) {
  const headings = text.matchAll(/^## \[\d+\.\d+\.\d+\].*$/gm).toArray()
  if (headings.length === 0) throw new Error('No released changelog section')
  const end = headings[RECENT_RELEASES]?.index ?? text.length
  return `${text.slice(0, end).trimEnd()}\n\n[Complete release history](${HISTORY}).\n`
}

export async function stageVsix(root, stage) {
  // The stage is build output in this worktree, never a user-selected folder.
  if (stage !== path.join(root, 'dist', 'vsix-package')) throw new Error('Invalid VSIX stage')
  const { L10N_COMPRESSION_QUALITY } = await loadL10n(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  )
  const files = await listFiles({ cwd: root, dependencies: false })
  const webview = JSON.parse(readFileSync(path.join(root, 'dist/meta/webview.json'), 'utf8'))
  for (const file of Object.keys(webview.outputs)) {
    if (!file.endsWith('.js')) continue
    if (!files.includes(file)) throw new Error(`Webview output excluded from VSIX: ${file}`)
  }
  if (!files.includes('dist/validation.js'))
    throw new Error('Shared validation runtime excluded from VSIX')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  for (const file of files) {
    const isUiTable = /^l10n\/ui\.[^/]+\.json$/.test(file)
    const target = path.join(stage, isUiTable ? `${file}.br` : file)
    mkdirSync(path.dirname(target), { recursive: true })
    if (COMPACT_JSON.test(file)) {
      const compact = JSON.stringify(JSON.parse(readFileSync(path.join(root, file), 'utf8')))
      writeFileSync(
        target,
        isUiTable
          ? brotliCompressSync(Buffer.from(compact), {
              params: { [zlibConstants.BROTLI_PARAM_QUALITY]: L10N_COMPRESSION_QUALITY },
            })
          : compact,
      )
    } else {
      copyFileSync(path.join(root, file), target)
    }
  }
  writeFileSync(
    path.join(stage, 'README.md'),
    readFileSync(path.join(root, 'docs/marketplace-readme.md')),
  )
  writeFileSync(
    path.join(stage, 'CHANGELOG.md'),
    packagedChangelog(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')),
  )
  return files
}

async function main() {
  const root = process.cwd()
  const stage = path.join(root, 'dist', 'vsix-package')
  await stageVsix(root, stage)
  // The same strict localization gate reads the exact staged bytes too.
  execFileSync(process.execPath, ['scripts/check-l10n.mjs', '--packaged', stage], {
    cwd: root,
    stdio: 'inherit',
  })
  const manifest = JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8'))
  const archive = path.join(root, `${manifest.name}-${manifest.version}.vsix`)
  await pack({ cwd: stage, dependencies: false, packagePath: archive })
  execFileSync(process.execPath, ['scripts/check-vsix-size.mjs', archive], {
    cwd: root,
    stdio: 'inherit',
  })
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main()
}

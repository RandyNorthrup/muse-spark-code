// Stage only VSCE's allowlisted files, compact JSON without changing its
// values, and package short landing docs. Source docs and tables stay readable.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { packRuntimeArchive } from './lib/packageArchive.mjs'
import { compactVsix } from './lib/compactVsix.mjs'
import { pathToFileURL } from 'node:url'
import { listFiles, pack } from '@vscode/vsce/out/package.js'
import { renderPackageReadme } from './check-badges.mjs'

const RECENT_RELEASES = 2
const HISTORY = 'https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md'
const COMPACT_JSON =
  /^(?:l10n\/(?:ui|usage)\.[^/]+\.json|dist\/(?:providerCatalog|whatsNew)\.json|package(?:\.nls(?:\.[^/]+)?)?\.json)$/

export function packagedChangelog(text) {
  const headings = text.matchAll(/^## \[\d+\.\d+\.\d+\].*$/gm).toArray()
  if (headings.length === 0) throw new Error('No released changelog section')
  const end = headings[RECENT_RELEASES]?.index ?? text.length
  const firstRelease = headings[0].index
  const prefix = text.slice(0, firstRelease)
  const highlights = prefix
    .split(/^### /m)
    .filter((part) => part.startsWith('Highlights\n'))
    .map((part) => part.slice('Highlights\n'.length).trim())
    .join('\n\n')
  const unreleased = prefix.includes('## [Unreleased]')
    ? `# Changelog\n\n## [Unreleased]\n\n${highlights === '' ? '' : `### Highlights\n\n${highlights}\n\n`}[Complete Unreleased notes](${HISTORY}#unreleased).\n\n`
    : prefix
  return `${unreleased}${text.slice(firstRelease, end).trimEnd()}\n\n[Complete release history](${HISTORY}).\n`
}

export async function stageVsix(root, stage) {
  // The stage is build output in this worktree, never a user-selected folder.
  if (stage !== path.join(root, 'dist', 'vsix-package')) throw new Error('Invalid VSIX stage')
  const files = await listFiles({ cwd: root, dependencies: false })
  for (const page of [
    'webview',
    'modelsWebview',
    'whatsNewPage',
    'usageWebview',
    'referencePage',
  ]) {
    const webview = JSON.parse(readFileSync(path.join(root, `dist/meta/${page}.json`), 'utf8'))
    for (const file of Object.keys(webview.outputs)) {
      if (!file.endsWith('.js')) continue
      if (!files.includes(file)) throw new Error(`Webview output excluded from VSIX: ${file}`)
    }
  }
  for (const arch of ['x64', 'arm64'])
    if (files.every((file) => file.replaceAll('\\', '/') !== `native/linux/${arch}/muse-created`))
      throw new Error(`Required Linux created-path helper excluded from VSIX: ${arch}`)
  if (!files.includes('dist/validation.js'))
    throw new Error('Shared validation runtime excluded from VSIX')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  const tables = []
  for (const file of files) {
    const isUiTable = /^l10n\/ui\.[^/]+\.json$/.test(file)
    if (isUiTable) {
      tables.push([
        path.basename(file).slice('ui.'.length, -'.json'.length),
        JSON.parse(readFileSync(path.join(root, file), 'utf8')),
      ])
      continue
    }
    const target = path.join(stage, file)
    mkdirSync(path.dirname(target), { recursive: true })
    if (COMPACT_JSON.test(file)) {
      writeFileSync(target, JSON.stringify(JSON.parse(readFileSync(path.join(root, file), 'utf8'))))
    } else {
      copyFileSync(path.join(root, file), target)
    }
  }
  const keys = Object.keys(tables[0]?.[1] ?? {})
  if (
    keys.length === 0 ||
    tables.some(([, table]) => JSON.stringify(Object.keys(table)) !== JSON.stringify(keys))
  )
    throw new Error('Translation tables have inconsistent key order')
  await packRuntimeArchive(root, stage, files, tables)
  writeFileSync(
    path.join(stage, 'README.md'),
    renderPackageReadme(
      readFileSync(path.join(root, 'docs/marketplace-readme.md'), 'utf8'),
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    ),
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
  execFileSync(process.execPath, ['scripts/check-badges.mjs', '--packaged-vsix', stage], {
    cwd: root,
    stdio: 'inherit',
  })
  execFileSync(process.execPath, ['test/packaging/moduleExports.test.mjs', 'vsix', stage], {
    cwd: root,
    stdio: 'inherit',
  })
  const manifest = JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8'))
  const archive = path.join(root, `${manifest.name}-${manifest.version}.vsix`)
  const result = await pack({ cwd: stage, dependencies: false, packagePath: archive })
  await compactVsix(archive, result.files)
  execFileSync(process.execPath, ['scripts/compress-vsix.mjs', archive], {
    cwd: root,
    stdio: 'inherit',
  })
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

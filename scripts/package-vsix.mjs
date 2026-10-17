// Stage only VSCE's allowlisted files, compact JSON without changing its
// values, and package short landing docs. Source docs and tables stay readable.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { packRuntimeArchive } from './lib/packageArchive.mjs'
import { compactVsix } from './lib/compactVsix.mjs'
import {
  contributedIds,
  fullNotesHref,
  parseChangelog,
  repositoryUrl,
  selectWhatsNewReleases,
} from './lib/whatsNewContent.mjs'
import { pathToFileURL } from 'node:url'
import { listFiles, pack } from '@vscode/vsce/out/package.js'
import { assertNoVsixFonts } from './notices-fonts.mjs'
import { renderPackageReadme } from './check-badges.mjs'

const RECENT_RELEASES = 2
const HISTORY = 'https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md'
const COMPACT_JSON =
  /^(?:l10n\/(?:ui|usage)\.[^/]+\.json|dist\/(?:providerCatalog|whatsNew)\.json|package(?:\.nls(?:\.[^/]+)?)?\.json)$/

/**
 * The Marketplace and VS Code changelog tab's CHANGELOG.md: the Unreleased
 * Highlights when there are any, then the planned releases, then the link
 * to the complete history. `releases` is the writer's own parse
 * (`parseChangelog`) of `text`, `plan` its selection
 * (`selectWhatsNewReleases`): each entry ships in full, or as its
 * Highlights only with a link to its full notes — a shortened entry without
 * Highlights as the link alone, exactly as the page shows it (an `omitted`
 * entry ships nothing) — so the packaged notes agree with What's New's page
 * on what is shown. Without a plan the newest RECENT_RELEASES releases ship
 * in full, as always. Every section is sliced by the parser's source
 * ranges; this file matches no heading of its own, so a fenced example or
 * an indented heading can never select or package a different section than
 * the writer did.
 */
export function packagedChangelog(text, releases, plan, repository) {
  if (releases.length === 0) throw new Error('No released changelog section')
  const [newest] = releases
  const unreleased = releases.unreleased
  const header =
    unreleased === undefined
      ? text.slice(0, newest.range.start)
      : `# Changelog\n\n## [Unreleased]\n\n${
          unreleased.highlightsStart === undefined
            ? ''
            : `### Highlights\n\n${text.slice(unreleased.highlightsStart, unreleased.highlightsEnd).trim()}\n\n`
        }[Complete Unreleased notes](${HISTORY}#unreleased).\n\n`
  if (plan === undefined) {
    const end = releases[RECENT_RELEASES]?.range.start ?? text.length
    return `${header}${text.slice(newest.range.start, end).trimEnd()}\n\n[Complete release history](${HISTORY}).\n`
  }
  const changelog = repository === undefined ? HISTORY : fullNotesHref(repository)
  const shipped = []
  for (const entry of plan) {
    const release = releases.find((candidate) => candidate.version === entry.version)
    if (release === undefined)
      throw new Error(`packagedChangelog: no released section for ${entry.version}`)
    if (entry.omitted === true) continue
    const range = text.slice(release.range.start, release.range.end).trimEnd()
    if (entry.full) {
      shipped.push(range)
      continue
    }
    const heading = text.slice(release.range.headingStart, release.range.headingEnd).trimEnd()
    if (release.range.highlightsStart === undefined) {
      // A shortened release without Highlights ships as its full-notes
      // link, exactly as the page shows it.
      shipped.push(`${heading}\n\n[Full notes for ${entry.version}](${changelog}).`)
      continue
    }
    const section = text.slice(release.range.highlightsStart, release.range.highlightsEnd).trimEnd()
    shipped.push(`${heading}\n\n${section}\n\n[Full notes for ${entry.version}](${changelog}).`)
  }
  return `${header}${shipped.join('\n\n')}\n\n[Complete release history](${HISTORY}).\n`
}

export async function stageVsix(root, stage) {
  // The stage is build output in this worktree, never a user-selected folder.
  if (stage !== path.join(root, 'dist', 'vsix-package')) throw new Error('Invalid VSIX stage')
  const files = await listFiles({ cwd: root, dependencies: false })
  assertNoVsixFonts(files)
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
  // The packaged notes ship the writer's own selection (full, Highlights
  // only, or left out), so they agree with What's New's page on what is
  // shown; the writer refuses when the newest release alone is over budget.
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const changelogText = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  const repository = repositoryUrl(manifest)
  const parsed = parseChangelog(changelogText, contributedIds(manifest), repository)
  const selection = selectWhatsNewReleases(parsed, repository)
  writeFileSync(
    path.join(stage, 'CHANGELOG.md'),
    packagedChangelog(changelogText, parsed, selection.plan, repository),
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

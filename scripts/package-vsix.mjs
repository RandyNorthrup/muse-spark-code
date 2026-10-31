// Stage only VSCE's allowlisted files, compact JSON without changing its
// values, and package short landing docs. Source docs and tables stay readable.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { packLegalDataArchive } from './lib/legalArchive.mjs'
import { packRuntimeArchive } from './lib/packageArchive.mjs'
import {
  listTextMembers,
  parseSolidTextArchive,
  packSolidTextArchive,
} from './lib/solidTextArchive.mjs'
import { compactVsix } from './lib/compactVsix.mjs'
import { removePackageStage } from './lib/packageStage.mjs'
import {
  contributedIds,
  fullNotesHref,
  parseChangelog,
  repositoryUrl,
  selectWhatsNewReleases,
} from './lib/whatsNewContent.mjs'
import { listFiles, pack } from '@vscode/vsce/out/package.js'
import { assertNoVsixFonts } from './notices-fonts.mjs'
import { assertPackagedBundles } from './check-packaged-bundles.mjs'
import { renderPackageReadme } from './check-badges.mjs'
import {
  VSIX_TARGETS,
  requiredNativeFiles,
  targetFromArgs,
  vsixArtifactName,
  isVsixTargetFile,
} from './lib/vsixTargets.mjs'
import { isEntryPoint } from './lib/entryPoint.mjs'

const RECENT_RELEASES = 2
const HISTORY = 'https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md'
const COMPACT_JSON =
  /^(?:l10n\/(?:ui|usage)\.[^/]+\.json|dist\/(?:providerCatalog|whatsNew)\.json|package(?:\.nls(?:\.[^/]+)?)?\.json)$/

/**
The Marketplace and VS Code changelog tab's CHANGELOG.md: the Unreleased
Highlights when there are any, then the planned releases, then the link
to the complete history. `releases` is the writer's own parse
(`parseChangelog`) of `text`, `plan` its selection
(`selectWhatsNewReleases`): each entry ships in full, or as its
Highlights only with a link to its full notes — a shortened entry without
Highlights as the link alone, exactly as the page shows it (an `omitted`
entry ships nothing) — so the packaged notes agree with What's New's page
on what is shown. Without a plan the newest RECENT_RELEASES releases ship
in full, as always. Every section is sliced by the parser's source
ranges; this file matches no heading of its own, so a fenced example or
an indented heading can never select or package a different section than
the writer did.
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

export async function stageVsix(root, stage, target) {
  // The stage is build output in this worktree, never a user-selected folder.
  if (stage !== path.join(root, 'dist', 'vsix-package')) throw new Error('Invalid VSIX stage')
  if (target !== undefined && !VSIX_TARGETS.includes(target))
    throw new Error(`Unknown VSIX target: ${target}`)
  const listed = await listFiles({ cwd: root, dependencies: false })
  assertNoVsixFonts(listed)
  assertPackagedBundles(root, listed)
  // One package per platform (PLAN.md D209, D210): a targeted package
  // stages only its own platform's native pieces; the untargeted fallback
  // keeps the neutral content plus the Linux helpers only.
  const files = listed.filter((file) => isVsixTargetFile(target, file))
  // VSIXWEB A: `dist/webview/**` ships as one solid brotli archive, not
  // loose members: every emitted webview script must be a member of the
  // packed archive below, and the loose files leave the stage with it.
  const webviewOutputs = new Set()
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
      webviewOutputs.add(file.replaceAll('\\', '/'))
    }
  }
  // requiredNativeFiles already enforces each target's own helpers (and both
  // arches for the universal stage): a second arch loop here predates
  // per-target staging and rejects every targeted stage, whose filter
  // rightly drops the other platforms' files.
  for (const required of requiredNativeFiles(target))
    if (files.every((file) => file.replaceAll('\\', '/') !== required))
      throw new Error(`Required native helper excluded from VSIX: ${required}`)
  const normalized = new Set(files.map((file) => file.replaceAll('\\', '/')))
  // D140: the Linux dictation helper ships as release assets, never in the
  // VSIX. Any helper binary staged for packaging refuses the whole stage.
  for (const arch of ['x64', 'arm64']) {
    for (const file of normalized) {
      if (
        file === `native/linux/${arch}/muse-dictate` ||
        (file.startsWith(`native/linux/${arch}/`) && /\.so(\.\d+)*$/.test(file))
      )
        throw new Error(`Linux dictation helper must not ship in the VSIX: ${file}`)
    }
  }
  for (const license of ['whisper-LICENSE.txt', 'model-LICENSE.txt'])
    if (!normalized.has(`native/dictation-linux/${license}`))
      throw new Error(`Required Linux dictation licence excluded from VSIX: ${license}`)
  if (!files.includes('dist/devices.js')) throw new Error('Lazy Devices runtime excluded from VSIX')
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
  // The pinned legal texts ship as one solid brotli archive (VSIXFIT A):
  // NOTICE.md and provenance.json stay loose beside it.
  packLegalDataArchive(stage)
  // The webview bundle ships as one solid brotli archive (VSIXWEB A):
  // `dist/webview.json.br` holds every file's exact text and SHA-256, and
  // the loose files leave the stage. The host extracts and verifies it on
  // first use (src/host/views/webviewBundleRoot.ts).
  // The ACP agent's voice companion lives in the same build tree but was
  // never allowlisted into the VSIX (the agent's npm package ships it
  // loose): it is excluded from the archive instead of joining it.
  // The stage never holds sourcemaps or the agent-only companion (VSCE
  // never allowlisted them), so the source-root pack excludes exactly
  // those: the archive holds the servable set, byte for byte.
  const webviewSource = path.join(root, 'dist', 'webview')
  packSolidTextArchive(webviewSource, path.join(stage, 'dist', 'webview.json.br'), {
    exclude: new Set([
      'voiceCompanion.js',
      'voiceCompanion.css',
      ...listTextMembers(webviewSource).filter((file) => file.endsWith('.map')),
    ]),
  })
  const webviewMembers = new Set(
    Object.keys(
      parseSolidTextArchive(
        readFileSync(path.join(stage, 'dist', 'webview.json.br')),
        4_000_000,
        1,
      ),
    ),
  )
  for (const output of webviewOutputs)
    if (!webviewMembers.has(output.replace(/^dist\/webview\//, '')))
      throw new Error(`Webview output excluded from the archive: ${output}`)
  // The vendored skill package ships as one solid brotli archive (VSIXWEB
  // B): every file's exact text and SHA-256 except LICENSE and VENDOR.json,
  // which stay loose (the legal evidence and the attribution a person
  // reads). The installer stages from the archive (src/host/skills/).
  packSolidTextArchive(
    path.join(root, 'vendor', 'high-quality-projects-skill'),
    path.join(stage, 'vendor', 'high-quality-projects-skill.json.br'),
    {
      keep: new Set(['LICENSE', 'VENDOR.json']),
    },
  )
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
  const target = targetFromArgs(process.argv.slice(2))
  const stage = path.join(root, 'dist', 'vsix-package')
  try {
    await stageVsix(root, stage, target)
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
    // vsce's own targeted name (`<name>-<target>-<version>.vsix`); the
    // TargetPlatform travels in the packed manifest beside the files.
    const archive = path.join(
      root,
      target === undefined
        ? `${manifest.name}-${manifest.version}.vsix`
        : vsixArtifactName(manifest.name, manifest.version, target),
    )
    const result = await pack({ cwd: stage, dependencies: false, packagePath: archive, target })
    await compactVsix(archive, result.files)
    execFileSync(process.execPath, ['scripts/compress-vsix.mjs', archive], {
      cwd: root,
      stdio: 'inherit',
    })
    execFileSync(process.execPath, ['scripts/check-vsix-size.mjs', archive], {
      cwd: root,
      stdio: 'inherit',
    })
  } finally {
    // The stage is build output, never an artifact: a stale stage poisons
    // later gates' scans of dist/, so it goes on success and on failure.
    removePackageStage(stage)
  }
}

if (isEntryPoint(import.meta.url)) {
  await main()
}

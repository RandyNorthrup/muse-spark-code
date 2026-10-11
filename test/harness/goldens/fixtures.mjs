// Test-only exceptional surfaces; all UI is rendered from the actual components.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { additionalScenes, makeAdditionalFixtures } from './additionalFixtures.mjs'

/** What the What's New screenshots show: two fixed releases, not the real notes. */
const WHATS_NEW_FIXTURE = 'test/harness/whats-new/CHANGELOG.fixture.md'
const fixtureSource = [
  "import React, {lazy} from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {ErrorBoundary} from './src/webview/components/ErrorBoundary';",
  "import {DeferredSurface} from './src/webview/components/DeferredSurface';",
  "import {SecretPromptDialog} from './src/webview/components/SecretPromptDialog';",
  "import * as icons from './src/webview/components/icons';",
  'const noop = () => {};',
  'const Suspended = lazy(() => new Promise(() => {}));',
  "function Crash() { throw new Error('Deliberate test-only render failure'); }",
  "const scene = new URLSearchParams(location.search).get('scene');",
  "const content = scene === 'crash'",
  ' ? <ErrorBoundary onError={noop} onReload={noop} onReportProblem={noop}><Crash/></ErrorBoundary>',
  ' : scene === \'secret\' ? <SecretPromptDialog redactedText="[redacted]" onEdit={noop} onSendAnyway={noop}/>',
  " : scene === 'icons' ? <div style={{display:'flex',flexWrap:'wrap',gap:16,padding:16}}>{Object.entries(icons).map(([name,Icon]) => <span key={name} title={name} style={{display:'grid',gap:8}}><Icon/><span>{name}</span></span>)}</div>",
  " : <DeferredSurface onClose={noop} isModal={scene !== 'deferred-popover'}><Suspended/></DeferredSurface>;",
  "createRoot(globalThis.document.getElementById('root')).render(content);",
].join('\n')
export const fixtureScenes = new Set([
  ...Object.keys(additionalScenes),
  'crash',
  'secret',
  'icons',
  'deferred-modal',
  'deferred-popover',
])

// The bundles and notes do not depend on the capture's origin, so one process
// builds them once (a capture run per scene hook used to rebuild them all),
// keeps the files in memory, and each run writes them with its own origin's pages.
const prepared = new Map()
async function prepareFixtures(auditRoot) {
  let pending = prepared.get(auditRoot)
  if (pending === undefined) {
    pending = buildFixtures(auditRoot)
    prepared.set(auditRoot, pending)
  }
  try {
    return await pending
  } catch (error) {
    prepared.delete(auditRoot)
    throw error
  }
}

async function buildFixtures(auditRoot) {
  await mkdir(path.join(auditRoot, 'temp'), { recursive: true })
  const directory = await mkdtemp(path.join(auditRoot, 'temp/m114-s-fixtures-shared-'))
  try {
    return await buildFixturesIn(auditRoot, directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function buildFixturesIn(auditRoot, directory) {
  await makeAdditionalFixtures(auditRoot, directory)
  await build({
    stdin: { contents: fixtureSource, resolveDir: auditRoot, loader: 'jsx' },
    outfile: path.join(directory, 'fixtures.js'),
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(
    path.join(directory, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>M114 component fixture</title><link rel="stylesheet" href="/dist/webview/main.css"></head><body><main id="root"></main><script src="fixtures.js"></script></body></html>`,
  )
  await build({
    stdin: {
      contents:
        "export { renderWhatsNewPage } from './src/host/whatsNew/whatsNewHtml'; export { encodeWhatsNewContent, parseWhatsNewContent, WHATS_NEW_CONTENT_SCHEMA_VERSION } from './src/core/whatsNew/whatsNewContent';",
      resolveDir: auditRoot,
      loader: 'ts',
    },
    absWorkingDir: auditRoot,
    outfile: path.join(directory, 'whatsNew.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const {
    renderWhatsNewPage,
    encodeWhatsNewContent,
    parseWhatsNewContent,
    WHATS_NEW_CONTENT_SCHEMA_VERSION,
  } = await import(pathToFileURL(path.join(directory, 'whatsNew.mjs')).href)
  const { contributedIds, parseChangelog, repositoryUrl } = await import(
    pathToFileURL(path.join(auditRoot, 'scripts/lib/whatsNewContent.mjs')).href
  )
  // The page is rendered from a fixed fixture, never from the real
  // CHANGELOG.md: a release's notes and its version move no frame. The real
  // builder and the real schema still make the content, and the manifest
  // still says which Try its may be shown.
  const manifest = JSON.parse(await readFile(path.join(auditRoot, 'package.json'), 'utf8'))
  const releases = parseChangelog(
    await readFile(path.join(auditRoot, WHATS_NEW_FIXTURE), 'utf8'),
    contributedIds(manifest),
    repositoryUrl(manifest),
  )
  const content = parseWhatsNewContent(
    encodeWhatsNewContent(JSON.stringify({ schema: WHATS_NEW_CONTENT_SCHEMA_VERSION, releases })),
  )
  const files = new Map()
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  for (const entry of entries)
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name)
      files.set(path.relative(directory, file), await readFile(file))
    }
  return { files, renderWhatsNewPage, releases: content.releases }
}

export async function makeFixtures(auditRoot, port) {
  const relative = `temp/m114-s-fixtures-${port}`
  const directory = path.join(auditRoot, relative)
  const { files, renderWhatsNewPage, releases } = await prepareFixtures(auditRoot)
  for (const [name, bytes] of files) {
    const file = path.join(directory, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }
  // Both fixture releases: the page shows two in full at most.
  const rendered = renderWhatsNewPage({
    releases,
    from: undefined,
    current: releases[0].version,
    isShownOnUpdate: true,
    cspSource: `http://127.0.0.1:${port}`,
    nonce: 'audit-fixture',
    locale: 'en',
    scriptUri: '/dist/webview/whatsNew.js',
    styleUri: '/dist/webview/whatsNew.css',
  })
  await writeFile(path.join(directory, 'whats-new.html'), rendered.html)
  const highlighted = releases.find((entry) => entry.highlights.length > 0)
  if (highlighted === undefined) throw new Error('Packaged notes need a highlight capture')
  const highlightPage = renderWhatsNewPage({
    releases: [{ ...highlighted, highlights: highlighted.highlights.slice(0, 1), sections: [] }],
    from: undefined,
    current: highlighted.version,
    isShownOnUpdate: true,
    cspSource: `http://127.0.0.1:${port}`,
    nonce: 'audit-fixture',
    locale: 'en',
    scriptUri: '/dist/webview/whatsNew.js',
    styleUri: '/dist/webview/whatsNew.css',
  })
  await writeFile(path.join(directory, 'whats-new-highlights.html'), highlightPage.html)
  return relative
}

// Test-only exceptional surfaces; all UI is rendered from the actual components.
import { rmSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { additionalScenes, makeAdditionalFixtures } from './additionalFixtures.mjs'
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
// builds them once (a capture run per scene hook used to rebuild them all);
// each run copies them and writes only its own origin's pages.
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
  const directory = path.join(auditRoot, `temp/m114-s-fixtures-shared-${String(process.pid)}`)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  process.once('exit', () => {
    rmSync(directory, { recursive: true, force: true })
  })
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
        "export { renderWhatsNewPage } from './src/host/whatsNew/whatsNewHtml'; export { parseWhatsNewContent } from './src/core/whatsNew/whatsNewContent';",
      resolveDir: auditRoot,
      loader: 'ts',
    },
    absWorkingDir: auditRoot,
    outfile: path.join(directory, 'whatsNew.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const { renderWhatsNewPage, parseWhatsNewContent } = await import(
    pathToFileURL(path.join(directory, 'whatsNew.mjs')).href
  )
  const { writeWhatsNewContent } = await import(
    pathToFileURL(path.join(auditRoot, 'scripts/lib/whatsNewContent.mjs')).href
  )
  writeWhatsNewContent(auditRoot)
  const content = parseWhatsNewContent(
    await readFile(path.join(auditRoot, 'dist/whatsNew.json'), 'utf8'),
  )
  return { directory, renderWhatsNewPage, releases: content.releases }
}

export async function makeFixtures(auditRoot, port) {
  const relative = `temp/m114-s-fixtures-${port}`
  const directory = path.join(auditRoot, relative)
  const { directory: source, renderWhatsNewPage, releases } = await prepareFixtures(auditRoot)
  await cp(source, directory, { recursive: true })
  const rendered = renderWhatsNewPage({
    releases: releases.filter((entry) => entry.version !== 'Unreleased').slice(0, 1),
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

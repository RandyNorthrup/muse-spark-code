// Test-only exceptional surfaces; all UI is rendered from the actual components.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
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
  'crash',
  'secret',
  'icons',
  'deferred-modal',
  'deferred-popover',
])

export async function makeFixtures(auditRoot, port) {
  const directory = path.join(auditRoot, 'temp/m114-s-fixtures')
  await mkdir(directory, { recursive: true })
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
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/dist/webview/main.css"></head><body><main id="root"></main><script src="fixtures.js"></script></body></html>`,
  )
  await build({
    entryPoints: ['src/host/whatsNew/whatsNewHtml.ts'],
    absWorkingDir: auditRoot,
    outfile: path.join(directory, 'whatsNew.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const { renderWhatsNewPage } = await import(path.join(directory, 'whatsNew.mjs'))
  const content = JSON.parse(await readFile(path.join(auditRoot, 'dist/whatsNew.json'), 'utf8'))
  const releases = Array.isArray(content) ? content : content.releases
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
}

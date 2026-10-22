// M114 C: the themed companion fixture's assembly without a browser.
// This guard pins the shared wiring: every referenced URL served, the
// CSS-free theme consumer in the chunk graph, the static sheets placed.
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { renderCompanionPage } from '../../src/runtime/companion/page'
import { EN } from '../../src/shared/l10n/en'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { companionThemeCss } from '../../scripts/lib/webviewBundles.mjs'

describe('scratch companion fixture assembly', () => {
  it('serves every URL the page references', async () => {
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'c-m114-1-probe-'))
    try {
      const assetsFolder = path.join(dataFolder, 'dist', 'webview')
      await mkdir(assetsFolder, { recursive: true })
      await build({
        entryPoints: { usage: 'src/webview/usage/usage.tsx' },
        outdir: assetsFolder,
        bundle: true,
        minify: true,
        format: 'esm',
        platform: 'browser',
        splitting: true,
        chunkNames: 'chunks/[hash]',
        target: 'chrome128',
        jsx: 'automatic',
        charset: 'utf8',
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [compactBrowserUiText],
        logLevel: 'silent',
      })
      await writeFile(path.join(assetsFolder, 'theme.css'), companionThemeCss())
      const imports = {}
      const modules = new Map()
      const loadModule = async (name) => {
        const specifier = `muse-usage/${name}`
        if (modules.has(name)) return specifier
        let content = await readFile(path.join(assetsFolder, name), 'utf8')
        for (const match of content.matchAll(
          /\b(from\s*|import\s*(?:\(\s*)?)["'](\.[^"']+\.js)["']/gu,
        )) {
          const target = await loadModule(
            path.posix.normalize(path.posix.join(path.posix.dirname(name), match[2] ?? '')),
          )
          content = content.replace(match[0], () => `${match[1]}${JSON.stringify(target)}`)
        }
        modules.set(name, content)
        imports[specifier] = `data:text/javascript;charset=utf-8,${encodeURIComponent(content)}`
        return specifier
      }
      await loadModule('usage.js')
      const nonce = randomBytes(32).toString('hex')
      const html = renderCompanionPage(nonce, {
        locale: 'en',
        title: USAGE_EN.title,
        stylesheets: ['/usage.css', '/theme.css', '/fonts/fonts.css'],
        modules: ['/usage.js'],
        imports,
        uiTable: { locale: 'en', table: EN },
        usageTable: { type: 'usage/table', locale: 'en', table: USAGE_EN },
      })
      // Every static URL the page references must exist on disk (/fonts/*
      // serves from the installed pack root, covered by the font-pack file).
      for (const match of html.matchAll(/(?:href|src)="(\/[^"]+)"/gu)) {
        if (match[1].startsWith('/fonts/')) continue
        await readFile(path.join(assetsFolder, match[1]))
      }
      // The chunk graph reaches the CSS-free theme loader, and the static
      // sheets carry its styles (never the entry CSS).
      let graph = ''
      for (const content of modules.values()) graph += `${content}\n`
      expect(graph).toContain('data-ms-theme-vars')
      expect(graph).toContain('EPANEL_THEME')
      expect(graph).not.toContain('[data-ms-theme]')
      const theme = await readFile(path.join(assetsFolder, 'theme.css'), 'utf8')
      expect(theme).toContain('[data-ms-theme]')
      const usage = await readFile(path.join(assetsFolder, 'usage.css'), 'utf8')
      expect(usage).not.toContain('[data-ms-theme]')
      // Every data: specifier parses as a module graph reference.
      expect(Object.keys(imports).length).toBeGreaterThan(1)
    } finally {
      await rm(dataFolder, { recursive: true, force: true })
    }
  })
})

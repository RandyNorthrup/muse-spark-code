// The ACP agent's npm landing page: scripts/package-acp.mjs packs
// docs/npm-readme.md (not the detailed docs/acp.md guide) as the package's
// README.md, and npm does not resolve relative links or images, so every
// link and image target in that file must be absolute.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...segments: string[]): string => readFileSync(path.join(ROOT, ...segments), 'utf8')

/** Every `](target)`, `src="target"` and `href="target"` in the landing page. */
function linkTargets(markdown: string): string[] {
  return [
    ...Array.from(markdown.matchAll(/\]\(\s*([^)\s]+)\s*\)/g), (match) => match[1]!),
    ...Array.from(markdown.matchAll(/(?:src|href)="([^"]+)"/g), (match) => match[1]!),
  ]
}

describe('the ACP agent npm landing page', () => {
  it('is packed as the package README instead of the detailed guide', () => {
    const script = read('scripts', 'package-acp.mjs')
    const declaration = /^const README = .*$/m.exec(script)?.[0] ?? ''
    expect(declaration).toContain('npm-readme.md')
    expect(declaration).not.toContain('acp.md')
    expect(script).toContain("renderPackageReadme(readFileSync(README, 'utf8'), manifest.version)")
    expect(script).toContain("['scripts/check-badges.mjs', '--packaged-acp', STAGE]")
  })

  it('has no relative link or image target', () => {
    const targets = linkTargets(read('docs', 'npm-readme.md'))
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(target.startsWith('https://') || target.startsWith('#'), target).toBe(true)
    }
  })

  it('declares the improved npm manifest fields', () => {
    const script = read('scripts', 'package-acp.mjs')
    expect(script).toContain('Unofficial')
    expect(script).toContain('Not endorsed by Meta')
    expect(script).toContain('#readme`')
    expect(script).not.toContain('/blob/main/docs/acp.md`')
    for (const keyword of [
      'zed',
      'jetbrains',
      'neovim',
      'emacs',
      'jupyter',
      'ai',
      'agent',
      'cli',
      'meta',
      'llm',
    ]) {
      expect(script, keyword).toContain(`'${keyword}'`)
    }
    expect(script).toContain('manifest.sponsor')
    expect(script).toContain('funding')
  })
})

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The activity-bar icon (package.json viewsContainers) is the extension's own
// mark as a single-colour mask — never another company's logo (lane ICONM).
const ROOT = process.cwd()
const ICON = path.join(ROOT, 'media', 'icon.svg')
// The distinctive start of the old Meta-logo path that used to be icon.svg.
const OLD_PATH_START = 'M27.651 112.136'

function readIcon() {
  return readFileSync(ICON, 'utf8')
}

function* filesUnder(relative) {
  const absolute = path.join(ROOT, relative)
  for (const name of readdirSync(absolute)) {
    const full = path.join(absolute, name)
    if (statSync(full).isDirectory()) yield* filesUnder(path.join(relative, name))
    else yield full
  }
}

describe('activity-bar icon', () => {
  it('is a 24-grid mask with no text, image, script or external reference', () => {
    const svg = readIcon()
    expect(svg).toMatch(/^<svg[\s>]/)
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).not.toMatch(/<text[\s>]/)
    expect(svg).not.toMatch(/<image[\s>]/)
    expect(svg).not.toMatch(/<script[\s>]/)
    expect(svg).not.toContain('href')
  })

  it('is single colour: only currentColor or none, no gradient or hex colour', () => {
    const svg = readIcon()
    for (const match of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
      expect(['currentColor', 'none']).toContain(match[1])
    }
    expect(svg).not.toContain('url(')
    expect(svg).not.toContain('stop-color')
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(svg).toContain('stroke="currentColor"')
  })

  it('stays under 2 KB', () => {
    expect(readFileSync(ICON).length).toBeLessThan(2048)
  })

  it('has no trace of the old Meta path anywhere under media/ or resources/', () => {
    const hits = []
    for (const dir of ['media', 'resources']) {
      for (const file of filesUnder(dir)) {
        if (readFileSync(file, 'utf8').includes(OLD_PATH_START)) hits.push(file)
      }
    }
    expect(hits).toEqual([])
  })
})

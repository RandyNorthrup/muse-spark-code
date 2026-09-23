// The walkthrough (PLAN.md D15) is Markdown and images VS Code loads from
// the installed extension: every step's file must exist, every image it
// shows must exist beside it, and the folder must be in the package.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'

const root = fileURLToPath(new URL('../..', import.meta.url))
const IMAGE_LINK = /!\[[^\]]*\]\(([^)]+)\)/g

describe('walkthrough resources', () => {
  const [walkthrough] = manifest.contributes.walkthroughs
  const steps = walkthrough?.steps ?? []

  it('has a Markdown file that opens with an image for every step', () => {
    expect(walkthrough).toBeDefined()
    for (const step of steps) {
      const file = path.join(root, step.media.markdown)
      expect(existsSync(file), step.id).toBe(true)
      const text = readFileSync(file, 'utf8')
      expect(text.startsWith('!['), step.id).toBe(true)
      const images = Array.from(text.matchAll(IMAGE_LINK), (match) => match[1] ?? '')
      expect(images.length, step.id).toBeGreaterThan(0)
      for (const image of images) {
        expect(existsSync(path.join(path.dirname(file), image)), `${step.id}: ${image}`).toBe(true)
      }
    }
  })

  it('is packaged and lives in one folder', () => {
    const ignore = readFileSync(path.join(root, '.vscodeignore'), 'utf8')
    expect(ignore).toContain('!resources/walkthrough/**')
    for (const step of steps) {
      expect(step.media.markdown.startsWith('resources/walkthrough/'), step.id).toBe(true)
    }
  })
})

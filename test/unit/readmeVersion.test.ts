// A release bumps package.json's version, and the README's "What's new"
// section must move with it. 0.12.1 and 0.13.0 both shipped with the README
// still headed "What's new in 0.12.0", because nothing tied that heading to
// the version. This fails the release PR itself instead.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const manifestJson: unknown = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
)
const manifest = z.object({ version: z.string() }).parse(manifestJson)
const heading = `## What's new in ${manifest.version}`
const anchor = `(#whats-new-in-${manifest.version.replaceAll('.', '')})`

function read(relative: string): string {
  return readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8')
}

function whatsNewHeadings(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith("## What's new in "))
}

describe("the README's What's new section and the manifest version", () => {
  it(`README.md has exactly one What's new section, for ${manifest.version}`, () => {
    expect(whatsNewHeadings(read('README.md'))).toEqual([heading])
  })

  it("README.md's contents line links to that section", () => {
    expect(read('README.md')).toContain(`[What's new]${anchor}`)
  })

  it(`the Marketplace README has the same section, for ${manifest.version}`, () => {
    expect(whatsNewHeadings(read('docs/marketplace-readme.md'))).toEqual([heading])
  })
})

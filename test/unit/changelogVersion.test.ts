// A release PR bumps package.json's version; the release workflow then reads
// that version's CHANGELOG section for its notes (scripts/changelog-notes.mjs).
// 0.12.0's first release run passed every check and stopped at that step,
// because a merge had dropped the `## [0.12.0]` heading. This fails the
// change itself instead, in the PR's checks.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const manifest = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')))
const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')

describe('CHANGELOG and the manifest version', () => {
  it(`has a dated section for ${manifest.version}`, () => {
    const heading = new RegExp(
      String.raw`^## \[${manifest.version.replaceAll('.', String.raw`\.`)}\] - \d{4}-\d{2}-\d{2}$`,
      'm',
    )
    expect(heading.test(changelog), `CHANGELOG.md needs "## [${manifest.version}] - <date>"`).toBe(
      true,
    )
  })
})

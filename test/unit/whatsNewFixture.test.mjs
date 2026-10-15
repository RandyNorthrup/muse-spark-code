import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  constructKinds,
  contributedIds,
  parseChangelog,
  repositoryUrl,
} from '../../scripts/lib/whatsNewContent.mjs'

// The What's New screenshots render this fixture, never the real notes, so a
// release (new notes, a new version) moves no frame. The price is that the
// fixture must keep up with what the real notes are made of: these tests.
const FIXTURE = 'test/harness/whats-new/CHANGELOG.fixture.md'
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const parse = (markdown) =>
  parseChangelog(markdown, contributedIds(manifest), repositoryUrl(manifest))
const RELEASE_HEADING = /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/gm
/** The text of the two newest released sections: what What's New shows in full. */
function newestTwo(markdown) {
  const starts = Array.from(markdown.matchAll(RELEASE_HEADING), (match) => match.index)
  return markdown.slice(starts[0], starts[2] ?? markdown.length)
}
const missingFrom = (fixture, notes) =>
  constructKinds(notes)
    .values()
    .filter((kind) => !constructKinds(fixture).has(kind))
    .toArray()
const byText = (left, right) => Number(left > right) - Number(left < right)
const fixtureText = readFileSync(FIXTURE, 'utf8')
// Two sections, not the whole history: each case parses them in milliseconds.
const realText = newestTwo(readFileSync('CHANGELOG.md', 'utf8'))

describe('the What’s New screenshot fixture', () => {
  it('holds every kind of part the real notes of the two newest releases are made of', () => {
    // A kind listed here is laid out on the real page and in no screenshot:
    // add it to the fixture, then re-render the whats-new scenes (docs/RELEASING.md).
    const real = parse(realText)
    expect(real).toHaveLength(2)
    expect(missingFrom(parse(fixtureText), real)).toEqual([])
  })

  it('is two fixed releases with every part the builder can make', () => {
    const releases = parse(fixtureText)
    expect(releases.map(({ version, date }) => `${version} ${date}`)).toEqual([
      '0.90.0 2026-01-15',
      '0.89.2 2025-12-01',
    ])
    expect(releases[0].highlights).toHaveLength(5)
    expect(releases[0].highlights.flatMap(({ tries }) => tries)).toEqual([
      { kind: 'command', id: 'museSpark.modelsAndAgents' },
      { kind: 'setting', id: 'museSpark.showWhatsNewOnUpdate' },
    ])
    expect(constructKinds(releases).values().toArray().toSorted(byText)).toEqual([
      'block:h',
      'block:list:bullets',
      'block:list:depth:1',
      'block:list:depth:2',
      'block:list:depth:3',
      'block:list:item-with-blocks',
      'block:list:ordered',
      'block:p',
      'block:pre',
      'block:quote',
      'highlight',
      'inline:br',
      'inline:code',
      'inline:del',
      'inline:em',
      'inline:link',
      'inline:strong',
      'inline:text',
      'release',
      'release:further',
      'section',
      'section:untitled',
      'try:command',
      'try:setting',
    ])
    // A word and a path that cannot wrap, for the narrowest width.
    expect(fixtureText).toMatch(/\b\w{90,}\b/)
  })

  it.each([
    ['a quote', '> A note the release quotes.', 'block:quote'],
    ['a code block', '```sh\nnpm test\n```', 'block:pre'],
    ['a numbered list', '1. first\n2. second', 'block:list:ordered'],
    ['a list three levels deep', '- a\n  - b\n    - c', 'block:list:depth:3'],
    ['struck-out text', 'A fix ~~withdrawn~~ again.', 'inline:del'],
    ['a deeper heading', '#### Details', 'block:h'],
  ])('names %s when the notes gain one the fixture lacks', (_case, addition, kind) => {
    // The real notes with the construct added to the newest release, against
    // the fixture without it.
    const notes = parse(realText.replace('\n', () => `\n\n${addition}\n`))
    expect(notes).toHaveLength(2)
    const without = parse(fixtureText).map((release) => ({
      ...release,
      highlights: [],
      sections: release.sections.map((section) => ({
        ...section,
        blocks: [{ t: 'p', c: [{ t: 'text', v: 'plain' }] }],
      })),
    }))
    expect(constructKinds(notes)).toContain(kind)
    expect(missingFrom(without, notes)).toContain(kind)
    expect(missingFrom(parse(fixtureText), notes)).toEqual([])
  })
})

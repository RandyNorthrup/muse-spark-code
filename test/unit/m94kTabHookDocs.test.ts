import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** A document's text with its line wrapping folded to single spaces. */
function documentText(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replaceAll(/\s+/g, ' ')
}

describe('Tab hook documentation (RVM94KR 5)', () => {
  it('says configured Cursor Tab hooks run and what they receive, everywhere it is told', () => {
    const privacy = documentText('docs/PRIVACY.md')
    expect(privacy).not.toContain('does not yet execute them')
    expect(privacy).toContain("**Cursor's Tab hooks run in this build.**")
    expect(privacy).toContain('its **full, unredacted text**')
    expect(privacy).toContain('stops Tab reading any file until it is fixed')
    for (const file of ['README.md', 'CHANGELOG.md']) {
      expect(documentText(file), file).toContain('**full, unredacted text**')
    }
    expect(documentText('CHANGELOG.md')).toContain(
      'The privacy guide said configured Cursor Tab hooks did not run',
    )
  })
})

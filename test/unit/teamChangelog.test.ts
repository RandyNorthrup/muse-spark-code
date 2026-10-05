import { describe, expect, it } from 'vitest'
import {
  changelogFragmentDirectory,
  isChangelogKept,
  mergeChangelog,
} from '../../src/core/team/merge/changelog'

const base =
  '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Existing note.\n\n## [1.0.0]\n\n### Fixed\n\n- Released note.\n'
function merge(ours: string, theirs: string): string {
  const result = mergeChangelog(base, ours, theirs)
  expect(result.kind).toBe('merged')
  if (result.kind !== 'merged') throw new Error(JSON.stringify(result))
  return result.text
}

describe('team CHANGELOG merge', () => {
  it('keeps ten parallel notes across an intervening release', () => {
    let ours = base
    for (let task = 0; task < 10; task++) {
      if (task === 5) ours = ours.replace('## [Unreleased]', '## [Unreleased]\n\n## [1.2.0]')
      const theirs = base.replace(
        '- Existing note.',
        () => `- Existing note.\n\n- Task ${String(task)}.`,
      )
      ours = merge(ours, theirs)
      expect(isChangelogKept(base, ours, theirs, ours)).toBe(true)
    }
    const [unreleased, released] = ours.split('## [1.2.0]', 2)
    for (let task = 0; task < 10; task++) {
      expect(ours.match(new RegExp(String.raw`Task ${String(task)}\.`, 'g'))).toHaveLength(1)
      expect(task < 5 ? released : unreleased).toContain(`- Task ${String(task)}.`)
    }
    expect(released).toContain('- Existing note.')
    expect(ours).toContain('## [1.0.0]\n\n### Fixed\n\n- Released note.')
  })

  it('applies authorized edits and removals while keeping unrelated bullets', () => {
    const ours = base.replace('- Existing note.', '- Existing note.\n\n- Ours.')
    const edited = base.replace('- Existing note.', '- Edited note.')
    const result = merge(ours, edited)
    expect(result).toContain('- Edited note.')
    expect(result).not.toContain('- Existing note.')
    expect(result).toContain('- Ours.')
    expect(merge(ours, base.replace('- Existing note.\n', ''))).not.toContain('- Existing note.')
    expect(isChangelogKept(base, ours, edited, result.replace('- Ours.\n', ''))).toBe(false)
  })

  it('refuses released changes and competing edits to one bullet', () => {
    expect(mergeChangelog('bad', base, base)).toMatchObject({
      kind: 'conflict',
      reason: 'structure',
    })
    expect(
      mergeChangelog(base, base, base.replace('Released note.', 'Changed release.')),
    ).toMatchObject({ kind: 'conflict', reason: 'released' })
    expect(
      mergeChangelog(
        base,
        base.replace('Existing note.', 'Ours.'),
        base.replace('Existing note.', 'Theirs.'),
      ),
    ).toMatchObject({ kind: 'conflict', reason: 'bullet' })
    expect(
      mergeChangelog(
        base,
        base.replace('[Unreleased]', '[1.2.0]'),
        base.replace('Existing note.', 'Edited.'),
      ),
    ).toMatchObject({ kind: 'conflict', reason: 'bullet' })
  })

  it('handles new sections, multiline bullets and moved bullets once', () => {
    const withTwo = base.replace(
      '- Existing note.',
      '- Existing note.\n\n- Second note.\n  Continued.',
    )
    const moved = withTwo.replace(
      '- Existing note.\n\n- Second note.\n  Continued.',
      '- Second note.\n  Continued.\n\n- Existing note.',
    )
    expect(mergeChangelog(withTwo, withTwo, moved)).toEqual({ kind: 'merged', text: withTwo })
    const theirs = base.replace('## [1.0.0]', '### Security\n\n- Protected.\n\n## [1.0.0]')
    expect(merge(base, theirs)).toContain('### Security\n\n- Protected.')
  })

  it('preserves BOM/CRLF and existing fragment conventions without folding them', () => {
    const ours = '\u{FEFF}' + base.replaceAll('\n', '\r\n')
    expect(merge(ours, base.replace('Existing note.', 'Edited note.'))).toContain(
      '\u{FEFF}# Changelog\r\n',
    )
    expect(changelogFragmentDirectory(['changelog.d/123.fixed.md'])).toBe('changelog.d/')
    expect(changelogFragmentDirectory(['.changeset/blue.md'])).toBe('.changeset/')
    expect(changelogFragmentDirectory(['newsfragments/123.bugfix'])).toBe('newsfragments/')
    expect(changelogFragmentDirectory(['CHANGELOG.md'])).toBeUndefined()
  })
})

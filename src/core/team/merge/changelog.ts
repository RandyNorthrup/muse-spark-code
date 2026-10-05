// Keep a Changelog: apply only the branch's Unreleased bullet delta to ours.
// Released material is immutable; moving a bullet is not a new bullet.
interface Bullet {
  release: string
  section: string
  identity: string
  text: string[]
  start: number
  end: number
}
interface Document {
  lines: string[]
  bullets: Bullet[]
  releases: { name: string; start: number }[]
  sections: { release: string; name: string; start: number }[]
}
export type ChangelogResult =
  | { kind: 'merged'; text: string }
  | { kind: 'conflict'; reason: 'structure' | 'released' | 'bullet' | 'kept'; identity: string }

function isUnreleased(release: string): boolean {
  return /^\[Unreleased\](?:\s|$)/i.test(release)
}

function parse(text: string): Document {
  const lines = text.replace(/^\u{FEFF}/u, '').split(/\r?\n/)
  const document: Document = { lines, bullets: [], releases: [], sections: [] }
  let release = ''
  let section = ''
  let fence = ''
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === '') fence = marker[0] ?? ''
      else if (fence === marker[0]) fence = ''
      continue
    }
    if (fence !== '') continue
    const heading = /^## (\[.+?\].*)$/.exec(line)?.[1]
    if (heading !== undefined) {
      release = heading
      section = ''
      document.releases.push({ name: release, start: index })
      continue
    }
    const category = /^### (.+)$/.exec(line)?.[1]
    if (release !== '' && category !== undefined) {
      section = category
      document.sections.push({ release, name: section, start: index })
      continue
    }
    if (release === '' || section === '' || !/^[-*] /.test(line)) continue
    let end = index + 1
    while (
      end < lines.length &&
      (/^\s+\S/.test(lines[end] ?? '') ||
        ((lines[end] ?? '') === '' && /^\s+\S/.test(lines[end + 1] ?? '')))
    )
      end++
    const bulletText = lines.slice(index, end)
    document.bullets.push({
      release,
      section,
      identity: JSON.stringify([
        release,
        section,
        bulletText.join(' ').replaceAll(/\s+/g, ' ').trim(),
      ]),
      text: bulletText,
      start: index,
      end,
    })
    index = end - 1
  }
  return document
}

function delta(
  base: Document,
  theirs: Document,
): ChangelogResult | { removed: Bullet[]; added: Bullet[] } {
  if (base.releases.length === 0 || theirs.releases.length === 0)
    return { kind: 'conflict', reason: 'structure', identity: '' }
  const baseIds = new Set(base.bullets.map((bullet) => bullet.identity))
  const branchIds = new Set(theirs.bullets.map((bullet) => bullet.identity))
  if (baseIds.size !== base.bullets.length || branchIds.size !== theirs.bullets.length)
    return { kind: 'conflict', reason: 'structure', identity: '' }
  const removed = base.bullets.filter((bullet) => !branchIds.has(bullet.identity))
  const added = theirs.bullets.filter((bullet) => !baseIds.has(bullet.identity))
  const released = [...removed, ...added].find((bullet) => !isUnreleased(bullet.release))
  if (released !== undefined)
    return { kind: 'conflict', reason: 'released', identity: released.identity }
  // Reject changes to released headings, prose, links, or fences as well.
  const releasedText = (document: Document): string =>
    document.lines
      .slice(
        document.releases.find((item) => !isUnreleased(item.name))?.start ?? document.lines.length,
      )
      .join('\n')
  return releasedText(base) === releasedText(theirs)
    ? { removed, added }
    : { kind: 'conflict', reason: 'released', identity: '' }
}

function isKept(
  ours: Document,
  result: Document,
  removed: readonly Bullet[],
  added: readonly Bullet[],
): boolean {
  const removedIds = new Set(removed.map((bullet) => bullet.identity))
  const resultIds = new Set(result.bullets.map((bullet) => bullet.identity))
  const expected = new Set(
    [...ours.bullets.filter((bullet) => !removedIds.has(bullet.identity)), ...added].map(
      (bullet) => bullet.identity,
    ),
  )
  for (const identity of expected) if (!resultIds.has(identity)) return false
  return resultIds.size === result.bullets.length && expected.size === resultIds.size
}

/** Also used to prove that a staging formatter has kept every authorized
 * edit/removal and every untouched integration bullet. */
export function isChangelogKept(
  base: string,
  ours: string,
  theirs: string,
  result: string,
): boolean {
  const change = delta(parse(base), parse(theirs))
  return !('kind' in change) && isKept(parse(ours), parse(result), change.removed, change.added)
}

export function mergeChangelog(
  baseText: string,
  oursText: string,
  theirsText: string,
): ChangelogResult {
  const base = parse(baseText)
  const ours = parse(oursText)
  if (ours.releases.length === 0) return { kind: 'conflict', reason: 'structure', identity: '' }
  const change = delta(base, parse(theirsText))
  if ('kind' in change) return change
  const oursIds = new Set(ours.bullets.map((bullet) => bullet.identity))
  const missing = change.removed.find((bullet) => !oursIds.has(bullet.identity))
  if (missing !== undefined)
    return { kind: 'conflict', reason: 'bullet', identity: missing.identity }
  const removedIds = new Set(change.removed.map((bullet) => bullet.identity))
  const lines = [...ours.lines]
  const removals = ours.bullets.filter((item) => removedIds.has(item.identity)).toReversed()
  for (const bullet of removals) lines.splice(bullet.start, bullet.end - bullet.start)
  const newline = oursText.includes('\r\n') ? '\r\n' : '\n'
  for (const addition of change.added) {
    if (oursIds.has(addition.identity)) continue
    let current = parse(lines.join(newline))
    let release = current.releases.find((item) => isUnreleased(item.name))
    if (release === undefined) {
      lines.splice(current.releases[0]?.start ?? lines.length, 0, '## [Unreleased]', '')
      current = parse(lines.join(newline))
      release = current.releases.find((item) => isUnreleased(item.name))
    }
    if (release === undefined)
      return { kind: 'conflict', reason: 'structure', identity: addition.identity }
    const nextRelease =
      current.releases.find((item) => item.start > release.start)?.start ?? lines.length
    const section = current.sections.find(
      (item) => isUnreleased(item.release) && item.name === addition.section,
    )
    const insert =
      section === undefined
        ? nextRelease
        : (current.sections.find((item) => item.start > section.start)?.start ?? nextRelease)
    const end = Math.min(insert, nextRelease)
    lines.splice(
      end,
      0,
      ...(section === undefined ? [`### ${addition.section}`, ''] : []),
      ...addition.text,
      '',
    )
    oursIds.add(addition.identity)
  }
  const text = `${oursText.startsWith('\u{FEFF}') ? '\u{FEFF}' : ''}${lines.join(newline)}`
  return isChangelogKept(baseText, oursText, theirsText, text)
    ? { kind: 'merged', text }
    : { kind: 'conflict', reason: 'kept', identity: '' }
}

/** Existing fragment convention wins; this lane never folds fragments. */
export function changelogFragmentDirectory(paths: readonly string[]): string | undefined {
  return ['changelog.d/', '.changeset/', 'newsfragments/'].find((directory) =>
    paths.some((path) => path.startsWith(directory)),
  )
}

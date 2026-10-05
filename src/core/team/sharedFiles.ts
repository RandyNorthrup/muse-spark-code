import * as z from 'zod/mini'
import { TEAM_WRITE_SET_MAX } from '../../shared/constants'
import { teamSharedFileSchema } from '../../shared/team'
import { compileGlob } from '../backends/modelapi/globLimits'

type SharedFile = z.infer<typeof teamSharedFileSchema>
const builtins: readonly SharedFile[] = [
  { pattern: 'CHANGELOG.md', kind: 'changelog' },
  { pattern: 'CHANGES.md', kind: 'changelog' },
  { pattern: 'package.nls*.json', kind: 'json-table' },
  { pattern: 'l10n/*.json', kind: 'json-table' },
  { pattern: 'locales/**/*.json', kind: 'json-table' },
  { pattern: 'i18n/**/*.json', kind: 'json-table' },
]

/** Lexical identity before matching or leasing. The host can supply the
 * volume's case policy; Windows/macOS default to conservative folding. */
export function canonicalTeamPath(
  path: string,
  isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin',
): string {
  const slashes = path.replaceAll('\\', '/')
  if (slashes.startsWith('/') || slashes.includes('\0')) throw new RangeError('writes')
  const parts: string[] = []
  for (const part of slashes.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new RangeError('writes')
      parts.pop()
    } else {
      if (parts.length === 0 && /^[A-Za-z]:/.test(part)) throw new RangeError('writes')
      parts.push(part)
    }
  }
  const normalized = parts.join('/')
  if (normalized === '') throw new RangeError('writes')
  return isCaseInsensitive ? normalized.toLowerCase() : normalized
}

/** Reuse the bounded glob compiler, rooted so a root literal never matches
 * another directory's file of the same name. */
export function teamPathMatcher(
  pattern: string,
  isCaseInsensitive?: boolean,
): (path: string) => boolean {
  const match = compileGlob(`team-root/${canonicalTeamPath(pattern, isCaseInsensitive)}`)
  return (path) => match(`team-root/${canonicalTeamPath(path, isCaseInsensitive)}`)
}

/** A conservative containment proof for fixed prefix/suffix wildcard rules.
 * The caller's bounded compiler caps brace expansion before this proof. */
function isPatternContained(rule: string, pattern: string): boolean {
  if (rule === pattern) return true
  if (!pattern.includes('[')) {
    const brace = /\{([^{}]*,[^{}]*)\}/.exec(pattern)
    if (brace !== null)
      return (brace[1] ?? '')
        .split(',')
        .every((option) =>
          isPatternContained(
            rule,
            pattern.slice(0, brace.index) + option + pattern.slice(brace.index + brace[0].length),
          ),
        )
  }
  const parts = /^([^*?{[]*)(\*\*\/\*|\*\*|\*)([^*?{[]*)$/.exec(rule)
  if (parts === null) return false
  const head = parts[1] ?? ''
  const tail = parts[3] ?? ''
  if (
    pattern.length < head.length + tail.length ||
    !pattern.startsWith(head) ||
    !pattern.endsWith(tail)
  )
    return false
  const middle = pattern.slice(head.length, pattern.length - tail.length)
  return (
    // A fixed suffix cannot be consumed as the close of a class/alternative.
    (!/[}\]]/.test(tail) || !/[{[]/.test(middle)) &&
    (parts[2] !== '*' || (!middle.includes('/') && !middle.includes('**')))
  )
}

function canPatternsOverlap(left: string, right: string, isCaseInsensitive: boolean): boolean {
  if (!/[*?{[]/.test(left)) return teamPathMatcher(right, isCaseInsensitive)(left)
  if (!/[*?{[]/.test(right)) return teamPathMatcher(left, isCaseInsensitive)(right)
  const a = left.split(/[*?{[]/, 1)[0] ?? ''
  const b = right.split(/[*?{[]/, 1)[0] ?? ''
  return a.startsWith(b) || b.startsWith(a)
}

export class SharedFiles {
  private readonly matches: { entry: SharedFile; match: (path: string) => boolean }[]
  readonly entries: readonly SharedFile[]

  constructor(
    user: readonly SharedFile[] = [],
    repository: readonly SharedFile[] = [],
    readonly isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin',
  ) {
    const schema = z.array(teamSharedFileSchema).check(z.maxLength(TEAM_WRITE_SET_MAX))
    const canonical = (entry: SharedFile): SharedFile => ({
      ...entry,
      pattern: canonicalTeamPath(entry.pattern, isCaseInsensitive),
    })
    const trusted = [
      ...builtins.map((entry) => canonical(entry)),
      ...schema.parse(user).map((entry) => canonical(entry)),
    ]
    const additions = schema.parse(repository).map((entry) => canonical(entry))
    const configured = [...trusted]
    for (const entry of additions) {
      const existing = configured.findLast((item) => item.pattern === entry.pattern)
      if (existing !== undefined && existing.kind !== entry.kind)
        throw new RangeError('sharedFiles')
      configured.push(entry)
    }
    // Repository additions cannot replace built-ins or explicit user choices,
    // and a later repository text rule cannot downgrade its own strict rule.
    this.entries = [
      ...additions.filter((entry) => entry.kind === 'text'),
      ...additions.filter((entry) => entry.kind !== 'text'),
      ...trusted,
    ]
    this.matches = this.entries.map((entry) => ({
      entry,
      match: teamPathMatcher(entry.pattern, isCaseInsensitive),
    }))
  }

  kind(path: string): SharedFile['kind'] | undefined {
    return this.matches.findLast((entry) => entry.match(path))?.entry.kind
  }

  shouldSerialize(path: string): boolean {
    const kind = this.kind(path)
    return kind === undefined || kind === 'text'
  }

  /** Bypass a lease only when a merge rule covers every possible file and
   * no higher-priority text override can intersect the declaration. */
  shouldSerializePattern(pattern: string): boolean {
    const normalized = canonicalTeamPath(pattern, this.isCaseInsensitive)
    if (!/[*?{[]/.test(normalized)) return this.shouldSerialize(normalized)
    compileGlob(`team-root/${normalized}`)
    for (const entry of this.entries.toReversed()) {
      if (
        entry.kind === 'text' &&
        canPatternsOverlap(entry.pattern, normalized, this.isCaseInsensitive)
      )
        return true
      if (entry.kind !== 'text' && isPatternContained(entry.pattern, normalized)) return false
    }
    return true
  }

  undeclaredTextFiles(changed: readonly string[], declared: readonly string[]): string[] {
    const matches = declared.map((pattern) => teamPathMatcher(pattern, this.isCaseInsensitive))
    return changed.filter(
      (path) => this.kind(path) === 'text' && matches.every((match) => !match(path)),
    )
  }
}

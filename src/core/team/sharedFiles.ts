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

/** Reuse the bounded glob compiler, but root a team path: unlike search,
 * a literal root file must not match another directory's file of that name. */
function foldPath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

export function teamPathMatcher(pattern: string): (path: string) => boolean {
  const match = compileGlob(`team-root/${foldPath(pattern)}`)
  return (path) => match(`team-root/${foldPath(path)}`)
}

export class SharedFiles {
  private readonly matches: { entry: SharedFile; match: (path: string) => boolean }[]
  readonly entries: readonly SharedFile[]

  constructor(user: readonly SharedFile[] = [], repository: readonly SharedFile[] = []) {
    const schema = z.array(teamSharedFileSchema).check(z.maxLength(TEAM_WRITE_SET_MAX))
    const configured = [...builtins, ...schema.parse(user)]
    for (const entry of schema.parse(repository)) {
      const existing = configured.findLast((item) => item.pattern === entry.pattern)
      if (existing !== undefined && existing.kind !== entry.kind)
        throw new RangeError('sharedFiles')
      configured.push(entry)
    }
    this.entries = configured
    this.matches = configured.map((entry) => ({ entry, match: teamPathMatcher(entry.pattern) }))
  }

  kind(path: string): SharedFile['kind'] | undefined {
    return this.matches.findLast((entry) => entry.match(path))?.entry.kind
  }

  shouldSerialize(path: string): boolean {
    const kind = this.kind(path)
    return kind === undefined || kind === 'text'
  }

  /** Literal files and the exact configured globs can bypass serialization.
   * A broader glob still leases any ordinary files it could also create. */
  shouldSerializePattern(pattern: string): boolean {
    const explicit = this.entries.findLast((entry) => entry.pattern === pattern)
    return explicit === undefined
      ? /[*?{[]/.test(pattern) || this.shouldSerialize(pattern)
      : explicit.kind === 'text'
  }

  undeclaredTextFiles(changed: readonly string[], declared: readonly string[]): string[] {
    const matches = declared.map((pattern) => teamPathMatcher(pattern))
    return changed.filter(
      (path) => this.kind(path) === 'text' && matches.every((match) => !match(path)),
    )
  }
}

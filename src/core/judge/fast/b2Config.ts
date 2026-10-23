// M125 lane F2 (D107 §9.5): what a B2 repository may be, and the
// configuration it may hold. Pure: the harness supplies file bytes
// and path answers; this module decides and names the reason in
// typed protocol words, never display text. Linux only.
import { YAMLParseError, parse as parseYaml } from 'yaml'
import { JUDGE_FAST_B2_CONFIG_KEYS } from '../../../shared/constants'

/** The repository markers that exclude it from B2, by presence. */
export interface B2ManagerFiles {
  readonly yarnLock: boolean
  readonly yarnrc: boolean
  readonly yarnrcYml: boolean
  readonly pnpmfile: boolean
}

/**
A repository whose package manager runs its own code first is not B2:
Yarn's configuration loads code before any script, and a pnpmfile is
code the manager runs. Names the exclusion.
*/
export function refusedByManagerFiles(files: B2ManagerFiles): 'yarn' | 'pnpmfile' | undefined {
  if (files.yarnLock || files.yarnrc || files.yarnrcYml) return 'yarn'
  return files.pnpmfile ? 'pnpmfile' : undefined
}

/** One effective configuration source and the keys it holds. */
export interface B2ConfigSource {
  readonly source: string
  readonly keys: readonly string[]
}

export type B2ConfigVerdict =
  { readonly ok: true } | { readonly ok: false; readonly source: string; readonly key: string }

/**
Every effective configuration source holds only safe keys: keys that
name no program, file or code. Compared lowercased: npm reads its keys
case-insensitively, and a case-variant of a safe key is inert where a
manager does not know it, while a dangerous key is caught in any case.
*/
export function checkB2ConfigKeys(sources: readonly B2ConfigSource[]): B2ConfigVerdict {
  const safe = new Set(JUDGE_FAST_B2_CONFIG_KEYS)
  for (const { source, keys } of sources) {
    for (const key of keys) {
      if (!safe.has(key.toLowerCase())) return { ok: false, source, key }
    }
  }
  return { ok: true }
}

/**
The keys of an `.npmrc`'s text: `key=value` lines, `#` and `;`
comments and blank lines. Anything else — a bare word, a section, a
key that is empty or holds whitespace — is unparseable, and an
unparseable source is refused, never guessed.
*/
export function npmrcKeys(text: string): string[] | undefined {
  const keys: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    const cut = line.indexOf('=')
    if (cut === -1) return undefined
    const key = line.slice(0, cut).trim()
    if (key === '' || /\s/u.test(key)) return undefined
    keys.push(key)
  }
  return keys
}

/**
The top-level keys of a `pnpm-workspace.yaml`'s text. Unparseable
text, a document that is not a mapping, or a non-string key is
refused, never guessed.
*/
export function pnpmWorkspaceKeys(text: string): string[] | undefined {
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error: unknown) {
    if (!(error instanceof YAMLParseError)) throw error
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const keys: string[] = []
  for (const key of Object.keys(parsed)) {
    if (typeof key !== 'string') return undefined
    keys.push(key)
  }
  return keys
}

/** The keys of a `package.json`'s `pnpm` field; absent holds none. */
export function pnpmFieldKeys(field: unknown): string[] | undefined {
  if (field === undefined) return []
  return typeof field !== 'object' || field === null || Array.isArray(field)
    ? undefined
    : Object.keys(field)
}

export type B2ManagerRefusal = 'managerNotFound' | 'workspaceTarget'

/**
The package manager resolved from the extension host's `PATH` with
every folder inside the workspace removed (Linux-only: entries split
on `:`). Relative entries are dropped unseen — one could be the
workspace. `resolveExecutable` answers the executable regular file a
candidate names through links, or nothing; a target inside the
workspace is refused, since a link there would run workspace code.
*/
export type B2ManagerVerdict =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: B2ManagerRefusal }

export function resolveB2Manager(
  pathValue: string,
  workspaceRoot: string,
  manager: 'npm' | 'pnpm',
  resolveExecutable: (candidate: string) => string | undefined,
): B2ManagerVerdict {
  const root = `${workspaceRoot.replaceAll('\\', '/').replace(/\/+$/u, '')}/`
  for (const entry of pathValue.split(':')) {
    if (entry === '' || !entry.startsWith('/')) continue
    const folder = `${entry.replaceAll('\\', '/').replace(/\/+$/u, '')}/`
    if (folder.startsWith(root)) continue
    const resolved = resolveExecutable(`${folder}${manager}`)
    if (!resolved?.startsWith('/')) continue
    return `${resolved.replaceAll('\\', '/')}/`.startsWith(root)
      ? { ok: false, reason: 'workspaceTarget' }
      : { ok: true, path: resolved }
  }
  return { ok: false, reason: 'managerNotFound' }
}

// M125 lane F2 (D107 §9.5): a B2 command's definition closure — the
// command's grammar, the strict script grammar, the fail-closed walk
// of the scripts reached, and the workspace files a reached script
// names. Pure: the harness supplies scripts, bytes and path answers;
// this module decides and names the reason in typed protocol words,
// never display text. Linux only.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { JUDGE_FAST_B2_SCRIPTS } from '../../../shared/constants'
import { checkB2ConfigKeys, refusedByManagerFiles, type B2ManagerFiles } from './b2Config'

/** A B2 check command: the manager, its script and its file filters. */
export interface B2Command {
  readonly manager: 'npm' | 'pnpm'
  readonly script: string
  readonly filters: readonly string[]
}

export type B2CommandRefusal =
  'notCheckCommand' | 'unknownScript' | 'option' | 'filterOption' | 'filterPath'

export type B2CommandVerdict =
  | { readonly ok: true; readonly command: B2Command }
  | { readonly ok: false; readonly reason: B2CommandRefusal }

/**
`npm test`, `npm run <script>`, `pnpm <script>` or `pnpm run
<script>`, with the script on the list and no option; after `--`,
only plain workspace-relative path operands, which could name a
setup file or update snapshots were they options.
*/
export function parseB2Command(line: string): B2CommandVerdict {
  const words = line
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '')
  const manager = words[0] === 'npm' || words[0] === 'pnpm' ? words[0] : undefined
  if (manager === undefined) return { ok: false, reason: 'notCheckCommand' }
  const rest = words.slice(1)
  let script: string | undefined
  let after: string[]
  if (manager === 'npm' && rest[0] === 'test') {
    script = 'test'
    after = rest.slice(1)
  } else if (rest[0] === 'run') {
    script = rest[1]
    after = rest.slice(2)
  } else if (manager === 'pnpm') {
    script = rest[0]
    after = rest.slice(1)
  } else {
    return { ok: false, reason: 'notCheckCommand' }
  }
  if (script === undefined) return { ok: false, reason: 'notCheckCommand' }
  if (!JUDGE_FAST_B2_SCRIPTS.includes(script)) return { ok: false, reason: 'unknownScript' }
  if (after.length === 0) return { ok: true, command: { manager, script, filters: [] } }
  if (after[0] !== '--') return { ok: false, reason: 'option' }
  const filters: string[] = []
  for (const filter of after.slice(1)) {
    if (filter === '--' || filter.startsWith('-')) return { ok: false, reason: 'filterOption' }
    const cleaned = filter.replaceAll('\\', '/')
    const parts = cleaned.split('/')
    if (
      cleaned === '' ||
      cleaned.startsWith('/') ||
      /^[a-z]:/iu.test(cleaned) ||
      parts.some((part) => ['', '.', '..'].includes(part)) ||
      !/^[\u{20}-\u{7E}]+$/u.test(cleaned)
    ) {
      return { ok: false, reason: 'filterPath' }
    }
    filters.push(cleaned)
  }
  return { ok: true, command: { manager, script, filters } }
}

/** One simple command: leading assignments, then the program and its words. */
export interface B2ScriptCommand {
  readonly assigns: readonly string[]
  readonly words: readonly string[]
}

export type B2ScriptRefusal = 'emptyScript' | 'syntax'

export type B2ScriptVerdict =
  | { readonly ok: true; readonly commands: readonly B2ScriptCommand[] }
  | { readonly ok: false; readonly reason: B2ScriptRefusal }

/**
A script's text under the strict grammar: simple commands joined by
`&&` or `||`; plain or quoted words; optional leading `NAME=value`
assignments. Anything else — a `;`, a pipe, a redirection, a `$`, a
backquote, a lone `&`, a parenthesis, a glob, a `~`, a `#`, a
newline — means not B2, inside quotes as well as out: the grammar
accepts only inputs whose `/bin/sh` meaning it models whole, and a
quoted `$` still expands while a quoted `;` needs exact quote
modeling to trust. A word quoting leaves empty is refused whole.
*/
export function parseB2ScriptText(text: string): B2ScriptVerdict {
  interface Word {
    readonly text: string
    readonly bare: boolean
  }
  const commands: B2ScriptCommand[] = []
  let words: Word[] = []
  let word = ''
  let isWordBare = true
  let isWordStarted = false
  let quote: "'" | '"' | undefined
  let isTrailingSeparator = false
  const endWord = (): void => {
    if (!isWordStarted) return
    if (word === '') throw new SyntaxError('a B2 script word is empty')
    words.push({ text: word, bare: isWordBare })
    word = ''
    isWordBare = true
    isWordStarted = false
  }
  const endCommand = (): void => {
    endWord()
    const assigns: string[] = []
    let first = 0
    while (
      first < words.length &&
      (words[first]?.bare ?? false) &&
      /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[first]?.text ?? '')
    ) {
      assigns.push(words[first]?.text ?? '')
      first += 1
    }
    if (first === words.length) throw new SyntaxError('a B2 script command holds no words')
    commands.push({ assigns, words: words.slice(first).map((entry) => entry.text) })
    words = []
  }
  try {
    let index = 0
    while (index < text.length) {
      const char = text.charAt(index)
      if (quote !== undefined) {
        if (char === quote) {
          quote = undefined
        } else if (B2_REFUSED_CHARS.has(char)) {
          return { ok: false, reason: 'syntax' }
        } else {
          word += char
          isWordBare = false
          isWordStarted = true
        }
        index += 1
        continue
      }
      if (char === "'" || char === '"') {
        quote = char
        isWordStarted = true
        isTrailingSeparator = false
        index += 1
        continue
      }
      if (char === ' ' || char === '\t') {
        endWord()
        index += 1
        continue
      }
      if (char === '&' || char === '|') {
        if (text.charAt(index + 1) !== char) return { ok: false, reason: 'syntax' }
        endWord()
        if (words.length === 0) return { ok: false, reason: 'syntax' }
        endCommand()
        isTrailingSeparator = true
        index += 2
        continue
      }
      if (B2_REFUSED_CHARS.has(char)) return { ok: false, reason: 'syntax' }
      word += char
      isWordStarted = true
      isTrailingSeparator = false
      index += 1
    }
    if (quote !== undefined) return { ok: false, reason: 'syntax' }
    endWord()
    if (isTrailingSeparator) return { ok: false, reason: 'syntax' }
    if (words.length > 0) endCommand()
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return { ok: false, reason: 'syntax' }
  }
  return commands.length === 0 ? { ok: false, reason: 'emptyScript' } : { ok: true, commands }
}

/** Characters the script grammar refuses anywhere, quoted or not. */
const B2_REFUSED_CHARS: ReadonlySet<string> = new Set([
  ';',
  '<',
  '>',
  '$',
  '`',
  '(',
  ')',
  '*',
  '?',
  '[',
  '{',
  '}',
  '!',
  '~',
  '#',
  '\n',
  '\r',
  '\\',
])

/** Flags that select other packages: never inside a B2 script's manager call. */
const PACKAGE_SELECTION_FLAGS: ReadonlySet<string> = new Set([
  '--workspace',
  '--workspaces',
  '-w',
  '--filter',
  '-r',
  '--recursive',
  '--prefix',
  '-C',
  '--dir',
])

/** How deep a manager re-invocation may nest (the entry is depth 0). */
const B2_WALK_MAX_DEPTH = 4

export type B2WalkRefusal =
  | 'scriptSyntax'
  | 'emptyScript'
  | 'missingScript'
  | 'scriptCycle'
  | 'tooDeep'
  | 'packageSelection'
  | 'managerUse'

/** One reached script: its name, its text and its parsed commands. */
export interface B2ReachedScript {
  readonly name: string
  readonly text: string
  readonly commands: readonly B2ScriptCommand[]
}

export type B2WalkVerdict =
  | { readonly ok: true; readonly reached: readonly B2ReachedScript[] }
  | { readonly ok: false; readonly reason: B2WalkRefusal; readonly at: string }

/**
The scripts reached, found by a fail-closed walk: the entry with its
`pre` and `post` entries; a command that runs the package manager
again adds its script with its hooks, to depth 4 and with no cycle.
A command selecting other packages, or any other manager
subcommand — including a re-invocation with extra words, whose flags
would escape the closure — means not B2, naming the script. Only
`npm` and `pnpm` commands are analyzed; the check's own programs run
contained. Reached commands come out per script, in visit order.
*/
export function walkB2Scripts(
  scripts: Readonly<Record<string, string>>,
  entry: string,
): B2WalkVerdict {
  interface Failure {
    readonly ok: false
    readonly reason: B2WalkRefusal
    readonly at: string
  }
  const reached: B2ReachedScript[] = []
  const done = new Set<string>()
  const visiting: string[] = []
  const visit = (name: string, depth: number): Failure | { readonly ok: true } => {
    if (visiting.includes(name)) return { ok: false, reason: 'scriptCycle', at: name }
    if (done.has(name)) return { ok: true }
    if (depth > B2_WALK_MAX_DEPTH) return { ok: false, reason: 'tooDeep', at: name }
    const text = scripts[name]
    if (text === undefined) return { ok: false, reason: 'missingScript', at: name }
    const parsed = parseB2ScriptText(text)
    if (!parsed.ok) {
      return {
        ok: false,
        reason: parsed.reason === 'emptyScript' ? 'emptyScript' : 'scriptSyntax',
        at: name,
      }
    }
    visiting.push(name)
    reached.push({ name, text, commands: [...parsed.commands] })
    for (const command of parsed.commands) {
      const program = command.words[0] ?? ''
      const base = program.includes('/') ? (program.split('/').pop() ?? '') : program
      if (base !== 'npm' && base !== 'pnpm') continue
      for (const word of command.words.slice(1)) {
        const flag = word.includes('=') ? (word.split('=', 1)[0] ?? '') : word
        if (PACKAGE_SELECTION_FLAGS.has(flag)) {
          visiting.pop()
          return { ok: false, reason: 'packageSelection', at: name }
        }
      }
      const args = command.words.slice(1)
      let nested: string | undefined
      if (base === 'npm' && args.length === 1 && args[0] === 'test') {
        nested = 'test'
      } else if (args.length === 2 && args[0] === 'run') {
        nested = args[1]
      } else if (base === 'pnpm' && args.length === 1) {
        nested = args[0]
      }
      if (nested === undefined || nested.startsWith('-')) {
        visiting.pop()
        return { ok: false, reason: 'managerUse', at: name }
      }
      for (const next of [`pre${nested}`, nested, `post${nested}`]) {
        if (scripts[next] === undefined) continue
        const inner = visit(next, depth + 1)
        if (!inner.ok) {
          visiting.pop()
          return inner
        }
      }
    }
    visiting.pop()
    done.add(name)
    return { ok: true }
  }
  for (const name of [`pre${entry}`, entry, `post${entry}`]) {
    if (name !== entry && scripts[name] === undefined) continue
    const outcome = visit(name, 0)
    if (!outcome.ok) return outcome
  }
  return { ok: true, reached }
}

/**
Every workspace file a word may name: the word itself, the value
past any `=`, and every suffix, so an attached short-flag value can
never hide a path. Existence gates pinning, so over-naming is
harmless; under-naming needs a path no substring holds, which shell
words without expansion cannot build.
*/
export function b2WordCandidates(word: string): readonly string[] {
  const out = new Set<string>([word])
  const cut = word.indexOf('=')
  if (cut !== -1) out.add(word.slice(cut + 1))
  for (let index = 1; index < word.length; index += 1) {
    out.add(word.slice(index))
  }
  return [...out]
}

/**
The candidate files of parsed commands, in first-seen order: every
later word and every assignment value, word-split; the program only
when it is a relative path (a bare name resolves through `PATH`,
never the workspace). Absolute candidates stay for the pinner to
drop: only workspace-relative paths pin.
*/
export function collectB2Candidates(commands: readonly B2ScriptCommand[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (word: string): void => {
    for (const candidate of b2WordCandidates(word)) {
      if (candidate === '' || seen.has(candidate)) continue
      seen.add(candidate)
      out.push(candidate)
    }
  }
  for (const command of commands) {
    for (const assign of command.assigns) {
      const value = assign.slice(assign.indexOf('=') + 1)
      for (const piece of value.split(/\s+/u)) {
        if (piece !== '') add(piece)
      }
    }
    const program = command.words[0] ?? ''
    if (program.includes('/') && !program.startsWith('/') && !/^[a-z]:/iu.test(program)) {
      add(program)
    }
    for (const word of command.words.slice(1)) add(word)
  }
  return out
}

/** A workspace file the closure pins: its path and bytes, or its link target. */
export type B2PinnedFile =
  | { readonly kind: 'file'; readonly path: string; readonly bytes: Uint8Array }
  | { readonly kind: 'link'; readonly path: string; readonly target: string }

/**
The closure's file answers, read from the snapshot, never the live
workspace: what an entry is without following it, and the bytes or
target it holds. Anything but a regular file or a link pins nothing.
*/
export interface B2FileAnswers {
  readonly statEntry: (relative: string) => 'file' | 'link' | 'other'
  readonly readEntryBytes: (relative: string) => Uint8Array | undefined
  readonly readEntryLink: (relative: string) => string | undefined
}

/**
The candidates that are workspace files, pinned with their bytes, or
links, pinned with their targets. Absolute candidates, drives and
paths escaping the workspace never reach the answers. A file that
vanishes between the stat and the read pins nothing: the snapshot is
frozen, so only a broken reader says that.
*/
/**
A candidate as a workspace-relative path, or nothing when it is
absolute, a drive, empty, or escapes the workspace.
*/
function normalizeB2Candidate(candidate: string): string | undefined {
  const cleaned = candidate.replaceAll('\\', '/')
  if (cleaned === '' || cleaned.startsWith('/') || /^[a-z]:/iu.test(cleaned)) return undefined
  const parts: string[] = []
  for (const part of cleaned.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

export function pinB2Files(
  candidates: readonly string[],
  answers: B2FileAnswers,
): readonly B2PinnedFile[] {
  const out: B2PinnedFile[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const relative = normalizeB2Candidate(candidate)
    if (relative === undefined || seen.has(relative)) continue
    seen.add(relative)
    const kind = answers.statEntry(relative)
    if (kind === 'file') {
      const bytes = answers.readEntryBytes(relative)
      if (bytes !== undefined) out.push({ kind: 'file', path: relative, bytes })
    } else if (kind === 'link') {
      const target = answers.readEntryLink(relative)
      if (target !== undefined) out.push({ kind: 'link', path: relative, target })
    }
  }
  return out
}

/** The `package.json` parts the closure pins, with fields canonicalized. */
export interface B2PackageJson {
  readonly scripts: Readonly<Record<string, string>>
  readonly fields: Readonly<Record<string, string>>
}

export type B2PackageJsonRefusal = 'invalidJson' | 'notObject' | 'scriptsShape'

export type B2PackageJsonVerdict =
  | { readonly ok: true; readonly packageJson: B2PackageJson }
  | { readonly ok: false; readonly reason: B2PackageJsonRefusal }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .toSorted(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
The closure's `package.json`: the scripts as strings, and the
`packageManager`, `workspaces` and `pnpm` fields canonicalized, so a
reformat alone never mismatches the baseline. Anything else in the
file is not definition.
*/
export function parseB2PackageJson(text: string): B2PackageJsonVerdict {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return { ok: false, reason: 'invalidJson' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'notObject' }
  }
  const scriptsRaw: unknown = parsed['scripts']
  if (!isRecord(scriptsRaw)) {
    return { ok: false, reason: 'scriptsShape' }
  }
  const scripts: Record<string, string> = {}
  for (const [name, body] of Object.entries(scriptsRaw)) {
    if (typeof body !== 'string') return { ok: false, reason: 'scriptsShape' }
    scripts[name] = body
  }
  const fields: Record<string, string> = {}
  for (const field of ['packageManager', 'workspaces', 'pnpm']) {
    if (parsed[field] !== undefined) fields[field] = canonicalJson(parsed[field])
  }
  return { ok: true, packageJson: { scripts, fields } }
}

/** A configuration source the closure pins: its name and raw bytes. */
export interface B2ConfigBytes {
  readonly source: string
  readonly keys: readonly string[]
  readonly bytes: Uint8Array
}

/** The definition closure: everything that selects or bootstraps the command. */
export interface B2DefinitionClosure {
  readonly scripts: readonly B2ReachedScript[]
  readonly fields: Readonly<Record<string, string>>
  readonly configs: readonly B2ConfigBytes[]
  readonly files: readonly B2PinnedFile[]
}

export type B2ClosureRefusal = B2WalkRefusal | B2PackageJsonRefusal | 'configKeys' | 'managerFiles'

export type B2ClosureVerdict =
  | { readonly ok: true; readonly closure: B2DefinitionClosure }
  | { readonly ok: false; readonly reason: B2ClosureRefusal; readonly at: string }

/**
The command's definition closure over the snapshot's answers: the
walked scripts, the `package.json` fields, the configuration bytes
whose keys all check, and the named files pinned. The caller reads
every byte from the snapshot, never the live workspace.
*/
export function collectB2Closure(
  command: B2Command,
  packageJson: B2PackageJson,
  managerFiles: B2ManagerFiles,
  configs: readonly B2ConfigBytes[],
  answers: B2FileAnswers,
): B2ClosureVerdict {
  const managerExcluded = refusedByManagerFiles(managerFiles)
  if (managerExcluded !== undefined) {
    return { ok: false, reason: 'managerFiles', at: managerExcluded }
  }
  const walked = walkB2Scripts(packageJson.scripts, command.script)
  if (!walked.ok) return walked
  const keys = checkB2ConfigKeys(configs)
  if (!keys.ok) return { ok: false, reason: 'configKeys', at: keys.source }
  const files = pinB2Files(
    walked.reached.flatMap((script) => collectB2Candidates(script.commands)),
    answers,
  )
  return {
    ok: true,
    closure: { scripts: walked.reached, fields: packageJson.fields, configs, files },
  }
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

/** Byte-order string comparison: locale-independent, so digests agree everywhere. */
function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

/**
The closure's digest: SHA-256 over the scripts, fields, configuration
bytes and pinned files in sorted order. The agreement record and the
not-B2 marks key on it.
*/
export function digestB2Closure(closure: B2DefinitionClosure): string {
  const scripts = closure.scripts
    .toSorted((left, right) => compareStrings(left.name, right.name))
    .map((script) => `${JSON.stringify(script.name)}:${JSON.stringify(script.text)}`)
  const fields = Object.keys(closure.fields)
    .toSorted(compareStrings)
    .map((field) => `${JSON.stringify(field)}:${closure.fields[field] ?? ''}`)
  const configs = closure.configs
    .toSorted((left, right) => compareStrings(left.source, right.source))
    .map((config) => `${JSON.stringify(config.source)}:${hex(config.bytes)}`)
  const files = closure.files
    .toSorted((left, right) => compareStrings(left.path, right.path))
    .map((file) =>
      file.kind === 'file'
        ? `${JSON.stringify(file.path)}=file:${hex(file.bytes)}`
        : `${JSON.stringify(file.path)}=link:${JSON.stringify(file.target)}`,
    )
  return createHash('sha256')
    .update([...scripts, ...fields, ...configs, ...files].join('\n'))
    .digest('hex')
}

/**
The exact invocation's digest: the manager, the script and the file
filters in order. A different filter is a different invocation, and
agrees on its own.
*/
export function digestB2Invocation(command: B2Command): string {
  return createHash('sha256')
    .update(
      [command.manager, command.script, ...command.filters]
        .map((part) => JSON.stringify(part))
        .join('\n'),
    )
    .digest('hex')
}

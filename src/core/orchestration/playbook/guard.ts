import { createHash } from 'node:crypto'
import parse from 'shell-quote/parse'
import quoteArguments from 'shell-quote/quote'
import { PLAYBOOK_LAUNDER_WINDOW_MS } from '../../../shared/constants'
import type {
  PlaybookAction,
  PlaybookCommand,
  PlaybookRecord,
  PlaybookWhyNote,
} from '../../../shared/playbook'

/** Hash only normalized effect/subject, never shell text. A different agent,
 * team or tool spelling cannot change a recorded refusal's identity. */
export function actionIdentity(action: PlaybookAction): string {
  return createHash('sha256')
    .update(JSON.stringify([action.effect.trim(), action.subject.trim()]))
    .digest('hex')
}

// A subcommand owns its short-option meanings: -n is dry-run on push and
// no-stat on merge/rebase, but bypasses hooks on commit. Value-taking options
// consume the rest of a cluster (or the next word), never reinterpret a message.
const gitOptions: Readonly<Record<string, { flags: string; values: string }>> = {
  commit: { flags: 'anqvs', values: 'mFCctu' },
  push: { flags: 'nqvfud', values: 'o' },
  merge: { flags: 'nqv', values: 'msSX' },
  rebase: { flags: 'nqvif', values: 'sX' },
  am: { flags: 'qis', values: 'p' },
  'cherry-pick': { flags: 'nexs', values: 'mSX' },
  revert: { flags: 'nes', values: 'mSX' },
}
const ordinaryGit = new Set([
  'status',
  'diff',
  'log',
  'show',
  'add',
  'restore',
  'switch',
  'checkout',
  'branch',
  'tag',
  'fetch',
  'pull',
  'clone',
  'init',
  'config',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'cat-file',
  'check-ignore',
  'help',
  'reset',
  'rm',
  'mv',
  'worktree',
  'clean',
  'describe',
  'remote',
  'grep',
  'blame',
  'reflog',
])
const hookKey = /^(?:core\.hookspath|hook\.)/iu

function isGitBlocked(words: readonly string[], seen: Set<string>): boolean {
  const aliases = new Map<string, string>()
  let index = 1
  while (words[index]?.startsWith('-')) {
    const word = words[index] ?? ''
    if (/^--(?:git-dir|work-tree|config-env)(?:=|$)/u.test(word) || word.startsWith('-C'))
      return true
    if (word === '-c' || word.startsWith('-c')) {
      const config = word === '-c' ? words[++index] : word.slice(2)
      if (!config || isConfigBlocked(config, seen)) return true
      if (config.toLowerCase().startsWith('alias.')) {
        const split = config.indexOf('=')
        aliases.set(config.slice('alias.'.length, split), config.slice(split + 1))
      }
    } else if (
      !['--no-pager', '--paginate', '--literal-pathspecs', '--no-optional-locks'].includes(word)
    ) {
      return true
    }
    index += 1
  }
  const command = words[index]
  if (!command) return true
  const args = words.slice(index + 1)
  const alias = aliases.get(command)
  if (alias !== undefined) {
    if (alias.startsWith('!')) return true // Shell aliases need an explicit effect review.
    return isShellBlocked(`git ${alias} ${quoteArguments(args)}`, seen)
  }
  if (command === 'config')
    return args.some(
      (arg, i) =>
        hookKey.test(arg) ||
        (arg.startsWith('alias.') && isConfigBlocked(`${arg}=${args[i + 1] ?? ''}`, seen)),
    )
  const options = gitOptions[command]
  if (!options) return !ordinaryGit.has(command) // Unknown aliases are opaque.
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (arg === '--') break
    if (/^--no-verify(?:=|$)/u.test(arg)) return true
    if (arg.startsWith('--')) {
      // Git accepts unique long-option abbreviations; reject bypass prefixes.
      if ('--no-verify'.startsWith(arg.split('=', 1)[0] ?? arg)) return true
      if (
        [
          '--message',
          '--file',
          '--reuse-message',
          '--reedit-message',
          '--template',
          '--author',
          '--date',
          '--trailer',
          '--strategy',
          '--strategy-option',
          '--mainline',
          '--push-option',
          '--receive-pack',
          '--exec',
          '--onto',
        ].includes(arg)
      )
        i += 1
      continue
    }
    if (arg === '-' || !arg.startsWith('-')) continue
    const extra = shortOptionOffset(arg.slice(1), command, options)
    if (extra === -1) return true
    i += extra
  }
  return false
}

function shortOptionOffset(
  cluster: string,
  command: string,
  options: { flags: string; values: string },
): number {
  for (let index = 0; index < cluster.length; index += 1) {
    const flag = cluster[index] ?? ''
    if (command === 'commit' && flag === 'n') return -1
    if (options.values.includes(flag)) return index === cluster.length - 1 ? 1 : 0
    if (!options.flags.includes(flag)) return -1
  }
  return 0
}

function isConfigBlocked(config: string, seen: Set<string>): boolean {
  const split = config.indexOf('=')
  if (split === -1) return true
  const key = config.slice(0, split)
  if (hookKey.test(key)) return true
  if (!key.toLowerCase().startsWith('alias.')) return false
  const value = config.slice(split + 1)
  return isShellBlocked(value.startsWith('!') ? value.slice(1) : `git ${value}`, seen)
}

function isInvocationBlocked(input: readonly string[], seen: Set<string>): boolean {
  let words = [...input]
  while (words.length > 0) {
    while (/^\w+=/u.test(words[0] ?? '')) {
      const assignment = words.shift() ?? ''
      if (
        /^(?:HUSKY(?:_SKIP_HOOKS)?=(?:0|1)$|GIT_(?:DIR|WORK_TREE|CONFIG[^=]*)=)/iu.test(assignment)
      )
        return true
    }
    const executable = (words[0] ?? '')
      .replaceAll('\\', '/')
      .split('/')
      .at(-1)
      ?.replace(/\.exe$/iu, '')
      .toLowerCase()
    if (executable === 'git') return isGitBlocked(words, seen)
    if (executable === 'env') {
      if (words[1] === '--') words.splice(1, 1)
      if (words[1]?.startsWith('-')) return true
      words = words.slice(1)
      continue
    }
    if (executable === 'xargs') {
      let index = 1
      while (words[index]?.startsWith('-')) {
        const option = words[index] ?? ''
        if (['-n', '-I', '-P', '-L'].includes(option)) index += 1
        else if (!/^(?:-[0tr]|-[nIPL].+|--)$/u.test(option)) return true
        index += 1
      }
      if (index >= words.length) return true
      words = words.slice(index)
      continue
    }
    if (['sh', 'bash', 'zsh', 'dash'].includes(executable ?? '')) {
      const flags = words[1]
      return (
        !flags ||
        !/^-[eluc]+$/u.test(flags) ||
        !flags.includes('c') ||
        !words[2] ||
        isShellBlocked(words[2], seen)
      )
    }
    if (['command', 'exec'].includes(executable ?? '')) {
      words = words.slice(1)
      if (words[0]?.startsWith('-')) return true
      continue
    }
    return ['if', 'then', 'for', 'while', 'case', 'eval', 'source', '.', 'function'].includes(
      executable ?? '',
    )
  }
  return false
}

/** shell-quote handles word concatenation, escapes and operators. Reject
 * expansions, substitutions, unmatched quotes and unsupported operators
 * instead of interpreting an uncertain command as harmless. */
function isShellBlocked(text: string, seen = new Set<string>()): boolean {
  if (seen.has(text)) return true
  const nextSeen = new Set(seen)
  nextSeen.add(text)
  let quote = ''
  let isEscaped = false
  let normalized = ''
  for (const char of text) {
    if (isEscaped) {
      isEscaped = false
      normalized += char
      continue
    }
    if (char === '\\' && quote !== "'") isEscaped = true
    else if (char === quote) quote = ''
    else if (!quote && ["'", '"'].includes(char)) quote = char
    else if (quote !== "'" && (char === '`' || char === '$')) return true
    normalized += char === '\n' && !quote ? ';' : char
  }
  if (quote || isEscaped) return true
  try {
    let words: string[] = []
    for (const token of parse(normalized)) {
      if (typeof token === 'string') {
        if (
          /^(?:HUSKY(?:_SKIP_HOOKS)?=(?:0|1)$|GIT_(?:DIR|WORK_TREE|CONFIG[^=]*)=)/iu.test(token) ||
          /(?:^|[/\\])\.husky(?:[/\\]|$)/iu.test(token)
        )
          return true
        words.push(token)
      } else {
        if ('comment' in token) break
        if (![';', '&&', '||', '|', '&'].includes(token.op) || isInvocationBlocked(words, nextSeen))
          return true
        words = []
      }
    }
    return isInvocationBlocked(words, nextSeen)
  } catch {
    return true
  }
}

export function commandBlock(
  command: PlaybookCommand,
  records: readonly PlaybookRecord[],
  at: number,
): PlaybookWhyNote['code'] | undefined {
  if (command.kind === 'gate' && command.skip) return 'gateSkipped'
  if (
    command.kind === 'edit' &&
    command.paths.some((path) => /(?:^|[/\\])\.husky(?:[/\\]|$)/iu.test(path))
  )
    return 'hookTampering'
  if (command.kind === 'shell') {
    if (isShellBlocked(command.command)) return 'hookTampering'
    const text = command.command.replaceAll(/["']/gu, '')
    if (/--skip-(?:checks|gates)\b/iu.test(text)) return 'gateSkipped'
  }
  const identity = actionIdentity(command)
  const refusals = records.filter(
    (record) =>
      record.kind === 'note' &&
      record.value.rule === 'neverAround' &&
      record.value.actor !== undefined &&
      record.value.module === identity,
  )
  if (
    refusals.some((record) => record.kind === 'note' && record.value.code === 'classifierBlocked')
  )
    return 'classifierBlocked'
  return refusals.some(
    (record) =>
      record.kind === 'note' &&
      ['permissionLaundering', 'hookTampering', 'gateSkipped'].includes(record.value.code) &&
      at - record.value.at < PLAYBOOK_LAUNDER_WINDOW_MS,
  )
    ? 'permissionLaundering'
    : undefined
}

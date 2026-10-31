import type { ShellDialect } from '../../backends/modelapi/shellSyntax'

export type GuardDialect = ShellDialect | 'cmd'
export interface ShellCommand {
  readonly argv: readonly string[]
  readonly redirects: readonly { readonly operator: string; readonly target: string }[]
  readonly isPipeline: boolean
}
export interface ShellProgram {
  readonly commands: readonly ShellCommand[]
  readonly isUnknown: boolean
}

const KEYWORDS =
  /^(?:if|for|while|until|case|function|foreach|switch|try|return|call|start|set|export|env|command|exec|nohup|sudo|start-process|set-alias|new-alias)$/i
const EXPANSION = /[$`]/
const CMD_EXPANSION = /[%!]/
const PS_SPECIAL = /[{}()[\],@]/
const BASH_SPECIAL = /[{}()[\]*?~]/
const INTERPRETER = /^(?:ba|da|z|k)?sh$|^(?:cmd|powershell|pwsh|python\d*|node|ruby|perl)$/i
const CODE_FLAG = /^(?:-[ce]|-command|-encodedcommand|\/c|\/k)$/i
const DYNAMIC = /^(?:eval|source|iex|invoke-expression|base64|xxd|certutil|\.)$/i
const ESCAPES: Readonly<Record<GuardDialect, string>> = { bash: '\\', cmd: '^', powershell: '`' }
const SPECIAL: Readonly<Record<GuardDialect, RegExp>> = {
  bash: BASH_SPECIAL,
  cmd: /[()]/,
  powershell: PS_SPECIAL,
}
const SHELL_FAMILY: Readonly<Record<string, GuardDialect>> = {
  powershell: 'powershell',
  pwsh: 'powershell',
  cmd: 'cmd',
}

/** A shell's literal word grammar; unresolved evaluation is retained as unknown. */
function wordAt(text: string, start: number, dialect: GuardDialect) {
  let value = ''
  let quote = ''
  let index = start
  let isUnknown = false
  while (index < text.length) {
    const char = text.charAt(index)
    if (quote === '' && /[\s;|&<>]/.test(char)) break
    const next = text.charAt(index + 1)
    const isQuote = char === '"' || (char === "'" && dialect !== 'cmd')
    if (isQuote && (quote === '' || quote === char)) {
      if (quote === char && dialect === 'powershell' && next === char) {
        value += char
        index += 2
        continue
      }
      quote = quote === '' ? char : ''
      index += 1
      continue
    }
    const escape = ESCAPES[dialect]
    const canEscape =
      char === escape &&
      (dialect === 'cmd' ? quote === '' : quote !== "'") &&
      (dialect !== 'bash' || quote !== '"' || /["\\$`\n]/.test(next))
    if (canEscape) {
      if (next === '' || /[\r\n]/.test(next)) isUnknown = true
      if (dialect === 'powershell' && /[0abefnrtuv]/i.test(next)) isUnknown = true
      value += next
      index += 2
      continue
    }
    if (
      (dialect === 'cmd' && CMD_EXPANSION.test(char)) ||
      (dialect !== 'cmd' && quote !== "'" && EXPANSION.test(char)) ||
      (quote === '' && SPECIAL[dialect].test(char))
    )
      isUnknown = true
    value += char
    index += 1
  }
  return { value, end: index, isUnknown: isUnknown || quote !== '' }
}

/** Parse a conservative literal subset. No unresolved syntax can earn a stop exemption. */
export function parseShell(text: string, dialect: GuardDialect): ShellProgram {
  const commands: ShellCommand[] = []
  let argv: string[] = []
  let redirects: { operator: string; target: string }[] = []
  let isUnknown = false
  let index = 0
  const finish = (isPipeline: boolean) => {
    if (argv.length > 0) commands.push({ argv, redirects, isPipeline })
    else if (isPipeline || redirects.length > 0) isUnknown = true
    argv = []
    redirects = []
  }
  while (index < text.length) {
    const char = text.charAt(index)
    if (/\s/.test(char)) {
      if (/[\r\n]/.test(char)) finish(false)
      index += 1
      continue
    }
    if (char === '#' && dialect !== 'cmd') {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
      continue
    }
    if (/[;|&]/.test(char)) {
      const isDoubled = text.charAt(index + 1) === char
      if ((char === '&' && !isDoubled) || (char === ';' && dialect === 'cmd')) isUnknown = true
      finish(char === '|' && !isDoubled)
      index += isDoubled ? 2 : 1
      continue
    }
    const redirect = /^(?:\d+)?(?:>>?|<<?|&>)/.exec(text.slice(index))?.[0]
    if (redirect !== undefined) {
      index += redirect.length
      while (/\s/.test(text.charAt(index)) && index < text.length) index += 1
      const target = wordAt(text, index, dialect)
      if (target.value === '' || redirect.includes('<<')) isUnknown = true
      isUnknown ||= target.isUnknown
      redirects.push({ operator: redirect, target: target.value })
      index = target.end
      continue
    }
    const word = wordAt(text, index, dialect)
    if (word.end === index) {
      isUnknown = true
      index += 1
    } else {
      argv.push(word.value)
      isUnknown ||= word.isUnknown
      index = word.end
    }
  }
  finish(false)
  const written = new Set(
    commands.flatMap((command) =>
      command.redirects
        .filter((redirect) => redirect.operator.includes('>'))
        .map((redirect) => redirect.target.replace(/^\.[\\/]/, '')),
    ),
  )
  for (const command of commands) {
    const name = commandName(command.argv[0] ?? '')
    const entry = command.argv[0] ?? ''
    if (
      written.has(entry.replace(/^\.[\\/]/, '')) ||
      /\.(?:sh|bash|ps1|cmd|bat)$/i.test(entry) ||
      KEYWORDS.test(name) ||
      DYNAMIC.test(name) ||
      /^(?:[\w]+)=/.test(entry) ||
      /^\.[\\/]/.test(entry) ||
      (INTERPRETER.test(name) &&
        command.argv.length > 1 &&
        command.argv.slice(1).some((arg) => !/^(?:--version|--help|-h|-v)$/i.test(arg))) ||
      (dialect === 'powershell' && /[^\t\r\n -~]/.test(text))
    )
      isUnknown = true
  }
  return { commands, isUnknown }
}

export function commandName(word: string): string {
  return (word.split(/[\\/]/).at(-1) ?? '').replace(/\.(?:exe|py)$/i, '').toLowerCase()
}

/** Only literal shell bodies can be inspected for unconditional refusals; wrappers stay unknown. */
export function literalShellBody(
  command: ShellCommand,
): { text: string; dialect: GuardDialect } | undefined {
  const name = commandName(command.argv[0] ?? '')
  if (/^(?:eval|iex|invoke-expression)$/.test(name) && command.argv.length > 1)
    return {
      text: command.argv.slice(1).join(' '),
      dialect: name === 'eval' ? 'bash' : 'powershell',
    }
  if (!INTERPRETER.test(name)) return undefined
  const flag = command.argv.findIndex((arg) => CODE_FLAG.test(arg))
  const text = command.argv[flag + 1]
  if (flag === -1 || text === undefined || /encodedcommand/i.test(command.argv[flag] ?? ''))
    return undefined
  const dialect = SHELL_FAMILY[name] ?? 'bash'
  return /^(?:(?:ba|da|z|k)?sh|cmd|powershell|pwsh)$/.test(name) ? { text, dialect } : undefined
}

// What a command line is, as the shell that runs it will read it (M78,
// PLAN.md D49): a list of plain commands, or something else. Command rules
// (commandRules.ts) allow only a list of plain commands, each judged alone;
// anything else asks.
//
// A plain command is words and nothing that expands, redirects or runs
// another command: no substitution (`$(…)`, backticks), no variable, glob,
// brace or tilde expansion, no redirection, no background `&`, no newline,
// no grouping, no keyword. The words are joined only by `;`, `|`, and in
// bash `&&` and `||`.
//
// Neither reader is a whole parser. Each accepts a small part of its
// shell's grammar exactly and refuses the rest, so a mistake can only make
// a command ask.
//
// - Bash follows its token rules (the bash manual's "Shell Operation"; the
//   subset matches Codex's tree-sitter one: words, quoted strings without
//   expansions, and `&&`, `||`, `;`, `|`). The tests compare its words with
//   the words bash itself hands a command.
// - PowerShell follows the tokenizer of Windows PowerShell 5.1, the shell
//   the tool runs. The tests compare its words with the AST that 5.1's own
//   parser (`[System.Management.Automation.Language.Parser]::ParseInput`)
//   builds for every command in the table (docs/certification/m78.md). It
//   refuses non-ASCII outright: PowerShell reads the typographic quotes and
//   dashes as quotes and dashes.

import { ASCII_DELETE_CODE, ASCII_SPACE_CODE } from '../../../shared/constants'

/** The shell a command line is written for: the Model API's shell tool on each platform. */
export type ShellDialect = 'bash' | 'powershell'

/** Why a command line is not a list of plain commands. */
export type ComplexReason =
  | 'empty'
  | 'newline'
  | 'substitution'
  | 'expansion'
  | 'redirection'
  | 'background'
  | 'grouping'
  | 'keyword'
  | 'callOperator'
  | 'quoting'
  | 'syntax'

export type CommandShape =
  | { readonly isPlain: true; readonly commands: readonly (readonly string[])[] }
  | { readonly isPlain: false; readonly reason: ComplexReason }

const SPACE = ' '
const TAB = '\t'
const SINGLE_QUOTE = "'"
const DOUBLE_QUOTE = '"'
const BACKSLASH = '\\'
const BACKTICK = '`'
const SEMICOLON = ';'
const PIPE = '|'
const AMPERSAND = '&'
const DOLLAR = '$'
const OPEN_PAREN = '('
const HASH = '#'
const COLON = ':'
const DASH = '-'
const LINE_BREAKS = /[\n\r]/
// PowerShell reads typographic quotes and dashes as their ASCII kin, and
// other non-ASCII spaces as spaces: only printable ASCII and the tab pass.
const POWERSHELL_OUTSIDE_ASCII = /[^\t -~]/

// Bash's characters that expand, redirect, group or comment outside quotes.
const BASH_REDIRECTIONS: ReadonlySet<string> = new Set(['<', '>'])
const BASH_GROUPING: ReadonlySet<string> = new Set(['(', ')'])
// Brace expansion, globs, tilde expansion, and `!` (a pipeline's negation,
// and extglob's `!(…)` where a profile turns extglob on).
const BASH_EXPANSIONS: ReadonlySet<string> = new Set(['{', '}', '*', '?', '[', ']', '~', '!'])
// The reserved words that start a compound command in bash (bash(1),
// "RESERVED WORDS"); `!`, `{`, `}`, `[[` and `]]` are refused as characters.
const BASH_KEYWORDS: ReadonlySet<string> = new Set([
  'case',
  'coproc',
  'do',
  'done',
  'elif',
  'else',
  'esac',
  'fi',
  'for',
  'function',
  'if',
  'in',
  'select',
  'then',
  'time',
  'until',
  'while',
])
// `NAME=value` before a command is an assignment, not the command's name.
const BASH_ASSIGNMENT = /^[A-Za-z_]\w*\+?=/

// PowerShell's characters that expand, group, redirect or comment in a
// bare word (the 5.1 tokenizer): variables and subexpressions, splatting,
// script blocks, type literals and indexes, arrays, redirections, and a
// comment. A backtick is its escape, and a quote inside a word joins the
// word to a string.
const POWERSHELL_EXPANSIONS: ReadonlySet<string> = new Set(['$', ','])
// Special only where a token starts: splatting and array, hash table and
// here-string openers (`@x`, `@(`, `@{`, `@'`), and a comment. Inside a
// word both are plain characters (`pkg@1.2`, `a#b`).
const POWERSHELL_TOKEN_STARTS: ReadonlySet<string> = new Set(['@', HASH])
// A bare word PowerShell reads as a number hands the command the number's
// value, not its text (`0x10` is 16, `1kb` is 1024, `05` is 5): only a
// plain integer passes, whose value is its text.
const POWERSHELL_NUMBER = /^(?:0x[\da-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)[dl]?(?:[kmgtp]b)?$/i
const POWERSHELL_PLAIN_INTEGER = /^(?:0|[1-9]\d{0,8})$/
const POWERSHELL_GROUPING: ReadonlySet<string> = new Set(['(', ')', '{', '}', '[', ']'])
const POWERSHELL_REDIRECTIONS: ReadonlySet<string> = new Set(['<', '>'])
const POWERSHELL_QUOTES: ReadonlySet<string> = new Set([SINGLE_QUOTE, DOUBLE_QUOTE, BACKTICK])
// The token that makes the rest of the line one verbatim argument.
const POWERSHELL_STOP_PARSING = '--%'
// A command's name is a bare word starting with a letter or an underscore,
// or a relative path; a number, a sign, a quote or a dot alone makes the
// statement an expression or a dot-sourcing instead (the 5.1 parser,
// docs/certification/m78.md).
const POWERSHELL_COMMAND_NAME = /^(?:[A-Za-z_]|\.\.?[\\/])/
const POWERSHELL_DOT_SOURCE = '.'
// PowerShell's keywords (5.1's `TokenKind` keywords and the workflow and
// configuration ones): a statement they start is not a command.
const POWERSHELL_KEYWORDS: ReadonlySet<string> = new Set([
  'assembly',
  'base',
  'begin',
  'break',
  'catch',
  'class',
  'clean',
  'command',
  'configuration',
  'continue',
  'data',
  'default',
  'define',
  'do',
  'dynamicparam',
  'else',
  'elseif',
  'end',
  'enum',
  'exit',
  'filter',
  'finally',
  'for',
  'foreach',
  'from',
  'function',
  'hidden',
  'if',
  'in',
  'inlinescript',
  'interface',
  'module',
  'namespace',
  'parallel',
  'param',
  'private',
  'process',
  'public',
  'return',
  'sequence',
  'static',
  'switch',
  'throw',
  'trap',
  'try',
  'type',
  'until',
  'using',
  'var',
  'while',
  'workflow',
])

function complex(reason: ComplexReason): CommandShape {
  return { isPlain: false, reason }
}

function isBlank(char: string): boolean {
  return char === SPACE || char === TAB
}

/** The words of plain commands as they are read, and how the last one ended. */
class CommandList {
  private words: string[] = []
  /** The operator that ended the last command, until the next word. */
  private pendingOperator: string | undefined
  public readonly commands: string[][] = []

  public addWord(word: string): void {
    this.words.push(word)
    this.pendingOperator = undefined
  }

  public get hasWords(): boolean {
    return this.words.length > 0
  }

  /** Whether the last command ended at `operator` and nothing has come since. */
  public isRightAfter(operator: string): boolean {
    return this.words.length === 0 && this.pendingOperator === operator
  }

  /** Ends the current command at `operator`; false when there is no command to end. */
  public end(operator: string): boolean {
    if (this.words.length === 0) {
      return false
    }
    this.commands.push(this.words)
    this.words = []
    this.pendingOperator = operator
    return true
  }

  /** The list, or why it is not one: an operator left with nothing after it. */
  public finish(trailingAllowed: ReadonlySet<string>): CommandShape {
    if (this.words.length > 0) {
      this.commands.push(this.words)
      this.words = []
    } else if (this.pendingOperator !== undefined && !trailingAllowed.has(this.pendingOperator)) {
      return complex('syntax')
    }
    return this.commands.length === 0
      ? complex('empty')
      : { isPlain: true, commands: this.commands }
  }
}

const BASH_TRAILING_ALLOWED: ReadonlySet<string> = new Set([SEMICOLON])

/** A double-quoted bash string from `start` (its opening quote): its text and where it ends. */
function bashDoubleQuoted(
  text: string,
  start: number,
): ComplexReason | { readonly value: string; readonly end: number } {
  let value = ''
  let index = start + 1
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === DOUBLE_QUOTE) {
      return { value, end: index + 1 }
    }
    if (char === DOLLAR || char === BACKTICK) {
      return char === BACKTICK || text.charAt(index + 1) === OPEN_PAREN
        ? 'substitution'
        : 'expansion'
    }
    if (char === BACKSLASH) {
      const next = text.charAt(index + 1)
      // Inside double quotes a backslash escapes `"` and `\` (and `$`,
      // backtick and a newline, which are refused); before anything else
      // it is itself.
      if (next === DOUBLE_QUOTE || next === BACKSLASH) {
        value += next
        index += 2
        continue
      }
      if (next === DOLLAR || next === BACKTICK) {
        return 'quoting'
      }
    }
    value += char
    index += 1
  }
  return 'quoting'
}

/** Why a bash character outside quotes makes a command other than plain, if it does. */
function bashCharacterProblem(
  text: string,
  index: number,
  isInWord: boolean,
): ComplexReason | undefined {
  const char = text.charAt(index)
  if (char === BACKSLASH) {
    return 'quoting'
  }
  const isBeforeParen = text.charAt(index + 1) === OPEN_PAREN
  if (char === DOLLAR) {
    return isBeforeParen ? 'substitution' : 'expansion'
  }
  if (char === BACKTICK) {
    return 'substitution'
  }
  if (BASH_REDIRECTIONS.has(char)) {
    // `<(…)` and `>(…)` are process substitutions.
    return isBeforeParen ? 'substitution' : 'redirection'
  }
  if (BASH_GROUPING.has(char)) {
    return 'grouping'
  }
  if (BASH_EXPANSIONS.has(char)) {
    return 'expansion'
  }
  // A `#` that starts a word starts a comment.
  return char === HASH && !isInWord ? 'syntax' : undefined
}

type BashOperator = { readonly operator: string } | { readonly reason: ComplexReason } | undefined

const AND_LIST = '&&'
const OR_LIST = '||'

/** A bash operator at `index`: its text, or why it is not one plain commands can take. */
function bashOperator(text: string, index: number): BashOperator {
  const char = text.charAt(index)
  const next = text.charAt(index + 1)
  if (char === AMPERSAND) {
    if (next === AMPERSAND) {
      return { operator: AND_LIST }
    }
    return { reason: next === '>' ? 'redirection' : 'background' }
  }
  if (char === PIPE) {
    if (next === PIPE) {
      return { operator: OR_LIST }
    }
    // `|&` pipes the error stream too: a redirection.
    return next === AMPERSAND ? { reason: 'redirection' } : { operator: PIPE }
  }
  if (char === SEMICOLON) {
    // `;;` ends a `case` branch.
    return next === SEMICOLON ? { reason: 'syntax' } : { operator: SEMICOLON }
  }
  return undefined
}

/** A bash command line's shape. */
function bashShape(text: string): CommandShape {
  const list = new CommandList()
  let word: string | undefined
  const endWord = () => {
    if (word === undefined) {
      return
    }

    list.addWord(word)
    word = undefined
  }
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (isBlank(char)) {
      endWord()
      index += 1
      continue
    }
    if (char === SINGLE_QUOTE) {
      const close = text.indexOf(SINGLE_QUOTE, index + 1)
      if (close === -1) {
        return complex('quoting')
      }
      word = `${word ?? ''}${text.slice(index + 1, close)}`
      index = close + 1
      continue
    }
    if (char === DOUBLE_QUOTE) {
      const quoted = bashDoubleQuoted(text, index)
      if (typeof quoted === 'string') {
        return complex(quoted)
      }
      word = `${word ?? ''}${quoted.value}`
      index = quoted.end
      continue
    }
    const found = bashOperator(text, index)
    if (found !== undefined) {
      if ('reason' in found) {
        return complex(found.reason)
      }
      endWord()
      if (!list.end(found.operator)) {
        return complex('syntax')
      }
      index += found.operator.length
      continue
    }
    const problem = bashCharacterProblem(text, index, word !== undefined)
    if (problem !== undefined) {
      return complex(problem)
    }
    word = `${word ?? ''}${char}`
    index += 1
  }
  endWord()
  const shape = list.finish(BASH_TRAILING_ALLOWED)
  if (!shape.isPlain) {
    return shape
  }
  for (const command of shape.commands) {
    const name = command[0] ?? ''
    if (BASH_KEYWORDS.has(name)) {
      return complex('keyword')
    }
    if (BASH_ASSIGNMENT.test(name)) {
      return complex('expansion')
    }
  }
  return shape
}

/**
 * A quoted PowerShell string from `start` (its opening quote): its text and
 * where it ends. A doubled quote is one quote; a double-quoted string that
 * would expand (`$`) or escape (backtick) is refused.
 */
function powerShellQuoted(
  text: string,
  start: number,
): ComplexReason | { readonly value: string; readonly end: number } {
  const quote = text.charAt(start)
  let value = ''
  let index = start + 1
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === quote) {
      if (text.charAt(index + 1) === quote) {
        value += quote
        index += 2
        continue
      }
      return { value, end: index + 1 }
    }
    if (quote === DOUBLE_QUOTE && (char === DOLLAR || char === BACKTICK)) {
      return char === DOLLAR ? 'expansion' : 'quoting'
    }
    value += char
    index += 1
  }
  return 'quoting'
}

/** Why a character of a PowerShell bare word makes the command other than plain, if it does. */
function powerShellWordProblem(char: string): ComplexReason | undefined {
  if (POWERSHELL_EXPANSIONS.has(char)) {
    return 'expansion'
  }
  if (POWERSHELL_GROUPING.has(char)) {
    return 'grouping'
  }
  if (POWERSHELL_REDIRECTIONS.has(char)) {
    return 'redirection'
  }
  if (POWERSHELL_QUOTES.has(char)) {
    return 'quoting'
  }
  return char === AMPERSAND ? 'background' : undefined
}

function isPowerShellBoundary(char: string): boolean {
  return char === '' || isBlank(char) || char === SEMICOLON || char === PIPE
}

/** One PowerShell token from `start`: its word and where it ends, or why it is refused. */
function powerShellToken(
  text: string,
  start: number,
): ComplexReason | { readonly word: string; readonly isQuoted: boolean; readonly end: number } {
  const first = text.charAt(start)
  if (first === SINGLE_QUOTE || first === DOUBLE_QUOTE) {
    const quoted = powerShellQuoted(text, start)
    if (typeof quoted === 'string') {
      return quoted
    }
    // `'a'b` is two tokens to PowerShell: a string glued to what follows is refused.
    return isPowerShellBoundary(text.charAt(quoted.end))
      ? { word: quoted.value, isQuoted: true, end: quoted.end }
      : 'quoting'
  }
  let index = start
  while (!isPowerShellBoundary(text.charAt(index))) {
    const problem = powerShellWordProblem(text.charAt(index))
    if (problem !== undefined) {
      return problem
    }
    index += 1
  }
  return { word: text.slice(start, index), isQuoted: false, end: index }
}

/** Why a PowerShell command's first token does not name a command, if it does not. */
function powerShellNameProblem(token: { readonly word: string; readonly isQuoted: boolean }) {
  if (token.word === POWERSHELL_DOT_SOURCE) {
    return 'callOperator'
  }
  if (token.isQuoted || !POWERSHELL_COMMAND_NAME.test(token.word)) {
    return 'syntax'
  }
  return POWERSHELL_KEYWORDS.has(token.word.toLowerCase()) ? 'keyword' : undefined
}

/**
 * Why a PowerShell argument is refused: the verbatim marker, a parameter
 * left without its value, or a number whose value is not its text.
 */
function powerShellArgumentProblem(token: {
  readonly word: string
  readonly isQuoted: boolean
}): ComplexReason | undefined {
  const { word, isQuoted } = token
  if (isQuoted) {
    return undefined
  }
  return word.startsWith(POWERSHELL_STOP_PARSING) ||
    (word.startsWith(DASH) && word.endsWith(COLON)) ||
    (POWERSHELL_NUMBER.test(word) && !POWERSHELL_PLAIN_INTEGER.test(word))
    ? 'syntax'
    : undefined
}

const POWERSHELL_TRAILING_ALLOWED: ReadonlySet<string> = new Set([SEMICOLON])

/** A Windows PowerShell 5.1 command line's shape. */
function powerShellShape(text: string): CommandShape {
  if (POWERSHELL_OUTSIDE_ASCII.test(text)) {
    return complex('syntax')
  }
  const list = new CommandList()
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (isBlank(char)) {
      index += 1
      continue
    }
    if (char === SEMICOLON) {
      // Empty statements (`;a`, `a;;b`) are allowed: 5.1 skips them. An
      // empty pipe element (`a | ;`) is not.
      if (list.isRightAfter(PIPE)) {
        return complex('syntax')
      }
      list.end(SEMICOLON)
      index += 1
      continue
    }
    if (char === PIPE) {
      // `||` is a chain operator only from PowerShell 7; 5.1 refuses it.
      if (text.charAt(index + 1) === PIPE || !list.end(PIPE)) {
        return complex('syntax')
      }
      index += 1
      continue
    }
    if (char === AMPERSAND) {
      // `&&` chains only from PowerShell 7; 5.1 refuses it.
      if (text.charAt(index + 1) === AMPERSAND) {
        return complex('syntax')
      }
      return complex(list.hasWords ? 'background' : 'callOperator')
    }
    if (POWERSHELL_REDIRECTIONS.has(char)) {
      return complex('redirection')
    }
    if (POWERSHELL_TOKEN_STARTS.has(char)) {
      return complex(char === HASH ? 'syntax' : 'expansion')
    }
    const token = powerShellToken(text, index)
    if (typeof token === 'string') {
      return complex(token)
    }
    const problem = list.hasWords ? powerShellArgumentProblem(token) : powerShellNameProblem(token)
    if (problem !== undefined) {
      return complex(problem)
    }
    list.addWord(token.word)
    index = token.end
  }
  return list.finish(POWERSHELL_TRAILING_ALLOWED)
}

/**
 * The command line's shape in its shell: its plain commands, each one's
 * words as the shell hands them to the command, or why it has none.
 */
export function commandShape(command: string, dialect: ShellDialect): CommandShape {
  if (LINE_BREAKS.test(command)) {
    return complex('newline')
  }
  if (hasControlCharacter(command)) {
    return complex('syntax')
  }
  return dialect === 'bash' ? bashShape(command) : powerShellShape(command)
}

/** A control character other than the tab (the line breaks are caught before). */
function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === ASCII_DELETE_CODE || (char !== TAB && code < ASCII_SPACE_CODE)) {
      return true
    }
  }
  return false
}

// Everything that can end one command and start another, or open a nested
// one, in either shell: what a forbid rule looks between (M78). A bash
// backtick opens a substitution; a PowerShell one is an escape, dropped.
const LOOSE_SEPARATORS: Readonly<Record<ShellDialect, RegExp>> = {
  bash: /[;&|(){}<>\n\r`$]+/,
  powershell: /[;&|(){}<>\n\r$@,]+/,
}
// What each shell drops from a word as it reads it: the quotes, and bash's
// backslash or PowerShell's backtick before a character (`r\m` and
// `` r`m `` are both `rm`).
const LOOSE_DROPPED: Readonly<Record<ShellDialect, RegExp>> = {
  bash: /["'\\]/g,
  powershell: /["'`]/g,
}
const WHITESPACE = /\s+/

/**
 * Every word of the command line, in runs between separators, for the
 * rules that match anywhere (forbid and ask). Quoted text is split too, so
 * a command handed to another shell as a string (`bash -c "rm -rf /"`) or
 * nested (`$(rm -rf /)`) is seen, and a word spelled with quotes or
 * escapes (`r"m"`, `r\m`) is read as the shell reads it. This reading is
 * wider than any shell's: it can only make a rule that tightens match more.
 */
export function looseWords(command: string, dialect: ShellDialect): readonly (readonly string[])[] {
  const runs: string[][] = []
  const segments = command.split(LOOSE_SEPARATORS[dialect])
  for (const segment of segments) {
    const words = segment
      .replaceAll(LOOSE_DROPPED[dialect], '')
      .split(WHITESPACE)
      .filter((word) => word !== '')
    if (words.length > 0) {
      runs.push(words)
    }
  }
  return runs
}

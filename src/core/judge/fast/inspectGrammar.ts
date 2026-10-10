import { isProtectedPath } from '../../protectedPaths'
import { isPrivateFileName } from '../../../shared/privateFiles'
import { countSecretMatches } from '../../../shared/redact'

export interface InspectCommand {
  readonly program: string
  readonly args: readonly string[]
  readonly operands: readonly string[]
  readonly recursive: boolean
}

function words(line: string): string[] | undefined {
  if (/[$`~;&|<>()\r\n\\\0"]/u.test(line) || countSecretMatches(line, []) > 0) return
  const result: string[] = []
  let rest = line.trim()
  while (rest.length > 0) {
    const match = /^(?:'([^']*)'|([^\s']+))(?:\s+|$)/u.exec(rest)
    if (match === null) return
    const plain = match[2]
    if (plain !== undefined && /[*?[\]{}]/u.test(plain)) return
    result.push(match[1] ?? plain ?? '')
    rest = rest.slice(match[0].length)
  }
  return result
}

function isOperand(word: string): boolean {
  const normalized = word.replaceAll('\\', '/')
  return (
    /^[\u{20}-\u{7E}]+$/u.test(normalized) &&
    !/^(?:\/|[a-z]:|[-!])/iu.test(normalized) &&
    !/[*?[\]{}]/u.test(normalized) &&
    normalized.split('/').every((part) => part !== '' && part !== '..') &&
    !isProtectedPath(normalized) &&
    normalized.split('/').every((part) => !isPrivateFileName(part))
  )
}

/** Positive option grammar; a miss belongs to the existing reviewer. */
export function parseInspectCommand(
  line: string,
  platform: NodeJS.Platform = process.platform,
): InspectCommand | undefined {
  if (platform !== 'linux' && platform !== 'darwin') return
  const tokens = words(line)
  if (tokens === undefined) return
  const program = tokens.shift()
  if (program === undefined) return
  const args = [...tokens]
  const operands: string[] = []
  let isRecursive = program === 'find' || program === 'du'
  let hasGrepPattern = false
  let hasOptions = true
  let isExpression = false
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i]
    if (word === undefined) return
    if (word === '--' && hasOptions && program !== 'find') {
      hasOptions = false
      continue
    }
    if (program === 'find' && (word === '!' || word.startsWith('-'))) isExpression = true
    if (program === 'find' && isExpression) {
      if (['!', '-a', '-o', '-print', '-empty'].includes(word)) continue
      const value = tokens[++i]
      if (value === undefined) return
      if (['-name', '-iname', '-path', '-ipath'].includes(word)) {
        if (!value) return
        continue
      }
      if (word === '-type' && /^[bcdflps]$/u.test(value)) continue
      if (['-mtime', '-mmin'].includes(word) && /^[+-]?\d+$/u.test(value)) continue
      if (word === '-size' && /^[+-]?\d+[cwbkMG]?$/u.test(value)) continue
      if (['-maxdepth', '-mindepth'].includes(word) && /^\d+$/u.test(value)) continue
      return
    }
    if (hasOptions && word.startsWith('-')) {
      if (program === 'stat') return
      if (program === 'ls' && /^-[laAhR1trSdF]+$/u.test(word)) {
        isRecursive ||= word.includes('R')
        continue
      }
      if (program === 'cat' && word === '-n') continue
      if (program === 'wc' && /^-[lwcm]+$/u.test(word)) continue
      if ((program === 'head' || program === 'tail') && (word === '-n' || word === '-c')) {
        if (!/^\d+$/u.test(tokens[++i] ?? '')) return
        continue
      }
      if (program === 'du') {
        if (/^-[shk]+$/u.test(word)) continue
        if (platform === 'linux' && /^--max-depth=\d+$/u.test(word)) continue
        if (platform === 'darwin' && word === '-d' && /^\d+$/u.test(tokens[++i] ?? '')) continue
        return
      }
      if (program === 'grep') {
        if (/^-[nirlLcEFwvxhH]+$/u.test(word)) {
          isRecursive ||= word.includes('r')
          continue
        }
        if (word === '-e' && tokens[i + 1] !== undefined) {
          i++
          hasGrepPattern = true
          continue
        }
        if (/^--(?:include|exclude)=.+$/u.test(word)) continue
      }
      return
    }
    if (program === 'grep' && !hasGrepPattern) {
      hasGrepPattern = true
      continue
    }
    if (!isOperand(word)) return
    operands.push(word)
  }
  if (!['ls', 'cat', 'head', 'tail', 'wc', 'stat', 'du', 'grep', 'find'].includes(program)) return
  if (program === 'grep' && !hasGrepPattern) return
  if (operands.length === 0) {
    if (['ls', 'find', 'du'].includes(program) || (program === 'grep' && isRecursive))
      operands.push('.')
    else return
  }
  return { program, args, operands, recursive: isRecursive }
}

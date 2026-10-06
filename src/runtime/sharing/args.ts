// Local commands only: these arguments never become a backend/model prompt.
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { SavedPrompt } from '../../shared/prompts'
import type { ShareRequest } from '../../shared/share'

interface LocalOptions {
  readonly cwd: string | undefined
}
export type SharingCommand =
  | (LocalOptions & {
      readonly command: 'share'
      readonly request: ShareRequest
      readonly exportedAt: string | undefined
      readonly confirmation: string | undefined
      readonly out: string | undefined
    })
  | (LocalOptions & {
      readonly command: 'prompts'
      readonly action: 'list'
      readonly search: string
      readonly tag: string | undefined
    })
  | (LocalOptions & {
      readonly command: 'prompts'
      readonly action: 'save'
      readonly title: string
      readonly scope: SavedPrompt['scope']
      readonly tags: readonly string[]
    })
  | (LocalOptions & {
      readonly command: 'prompts'
      readonly action: 'use'
      readonly promptId: string
      readonly scope: SavedPrompt['scope']
      readonly chat: 'active' | 'new'
    })

export function localArgumentError(argument: string): Error {
  return new Error(fill(UI_TEXT.acpUnknownArgument, { argument }))
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value)
  if (found === undefined) throw localArgumentError(value)
  return found
}

/** Strict action-specific flags; a misspelled privacy option cannot broaden a share. */
export function parseSharingArgs(argv: readonly string[], sessionId?: string): SharingCommand {
  const [root, action, ...args] = argv
  if (root !== 'share' && root !== 'prompts') throw localArgumentError(root ?? '')
  if (root === 'share' && action !== 'chat') throw localArgumentError(action ?? '')
  const isShare = root === 'share' || action === 'share'
  const flags: NonNullable<ParseArgsConfig['options']> = {
    cwd: { type: 'string' },
    ...(isShare && {
      mode: { type: 'string' },
      format: { type: 'string' },
      destination: { type: 'string' },
      out: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'no-code-blocks': { type: 'boolean' },
      'no-attachment-names': { type: 'boolean' },
      diffs: { type: 'boolean' },
      'attachment-content': { type: 'string', multiple: true },
      'exported-at': { type: 'string' },
      confirm: { type: 'string' },
    }),
    ...(root === 'prompts' && action !== 'list' && { scope: { type: 'string' } }),
    ...(action === 'list' && { search: { type: 'string' }, tag: { type: 'string' } }),
    ...(action === 'save' && {
      title: { type: 'string' },
      tag: { type: 'string', multiple: true },
    }),
    ...(action === 'use' && { chat: { type: 'string' } }),
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: flags,
  })
  const flag = (name: string) => {
    const value = values[name]
    if (value === undefined || typeof value === 'string') return value
    throw localArgumentError(`--${name}`)
  }
  const listFlag = (name: string): string[] => {
    const value = values[name]
    if (value === undefined) return []
    if (Array.isArray(value)) {
      const strings = value.filter((entry): entry is string => typeof entry === 'string')
      if (strings.length === value.length) return strings
    }
    throw localArgumentError(`--${name}`)
  }
  if (Object.values(values).includes('')) throw localArgumentError(argv.join(' '))
  const cwd = flag('cwd')
  const [id, ...extra] = positionals
  if (extra.length > 0) throw localArgumentError(extra.join(' '))
  if (action === 'list' && root === 'prompts' && id === undefined) {
    return { command: 'prompts', action, cwd, search: flag('search') ?? '', tag: flag('tag') }
  }
  const scope = oneOf(flag('scope') ?? 'user', ['user', 'workspace'])
  const title = flag('title')
  if (action === 'save' && root === 'prompts' && id === undefined && title !== undefined) {
    return { command: 'prompts', action, cwd, title, scope, tags: listFlag('tag') }
  }
  if (action === 'use' && root === 'prompts' && id !== undefined) {
    return {
      command: 'prompts',
      action,
      cwd,
      promptId: id,
      scope,
      chat: oneOf(flag('chat') ?? 'active', ['active', 'new']),
    }
  }
  if (!isShare) throw localArgumentError(argv.join(' '))
  const target = root === 'share' ? 'chat' : 'prompt'
  const identity = id ?? (target === 'chat' ? sessionId : undefined)
  if (identity === undefined || identity === '') throw localArgumentError(argv.join(' '))
  const from = flag('from')
  const to = flag('to')
  if ((from === undefined) !== (to === undefined)) throw localArgumentError('--from/--to')
  if (target === 'prompt' && from !== undefined) throw localArgumentError('--from/--to')
  const destination = oneOf(flag('destination') ?? (flag('out') === undefined ? 'copy' : 'file'), [
    'copy',
    'file',
    'browser',
  ])
  if (destination !== 'file' && flag('out') !== undefined) throw localArgumentError('--out')
  const common = {
    mode: oneOf(flag('mode') ?? 'conversation', ['full', 'conversation']),
    format: oneOf(flag('format') ?? 'md', ['md', 'html', 'json']),
    destination,
    options: {
      codeBlocks: values['no-code-blocks'] !== true,
      attachmentNames: values['no-attachment-names'] !== true,
      diffs: values['diffs'] === true,
      attachmentContents: listFlag('attachment-content'),
    },
  }
  const request: ShareRequest =
    target === 'chat'
      ? {
          ...common,
          target,
          sessionId: identity,
          ...(!(from === undefined || to === undefined) && { range: { from, to } }),
        }
      : { ...common, target, source: { kind: 'saved', promptId: identity, scope } }
  return {
    command: 'share',
    cwd,
    request,
    exportedAt: flag('exported-at'),
    confirmation: flag('confirm'),
    out: flag('out'),
  }
}

/** Our slash syntax, not a shell: quoted arguments, then verbatim save text after ` -- `. */
export function parseSharingSlash(text: string, sessionId: string) {
  const invocation = /^\/(share|prompt)(?=\s|$)/.exec(text)
  if (invocation === null) return
  const tokens: string[] = []
  let body: string | undefined
  let remaining = text.slice(1).trimStart()
  while (remaining !== '') {
    const token = /^(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s"']+))(?=\s|$)/.exec(remaining)
    if (token === null) throw localArgumentError(`/${invocation[1] ?? ''}`)
    if (token[3] === '--' && remaining.length > token[0].length) {
      const delimiterLength = remaining.startsWith('\r\n', token[0].length) ? 2 : 1
      body = remaining.slice(token[0].length + delimiterLength)
      break
    }
    const value: unknown =
      token[1] === undefined ? (token[2] ?? token[3]) : JSON.parse(`"${token[1]}"`)
    if (typeof value !== 'string') throw localArgumentError(`/${invocation[1] ?? ''}`)
    tokens.push(value)
    remaining = remaining.slice(token[0].length).trimStart()
  }
  if (tokens[0] === 'prompt') tokens[0] = 'prompts'
  const command = parseSharingArgs(tokens, sessionId)
  if (
    command.cwd !== undefined ||
    (command.command === 'share' && command.confirmation !== undefined)
  ) {
    throw localArgumentError('--cwd/--confirm')
  }
  if ((command.command === 'prompts' && command.action === 'save') !== (body !== undefined)) {
    throw localArgumentError(`/${invocation[1] ?? ''}`)
  }
  return { command, body }
}

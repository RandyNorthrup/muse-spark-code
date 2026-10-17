// Local commands only: these arguments never become a backend/model prompt.
import { parseArgs, type ParseArgsConfig } from 'node:util'
import {
  PROMPTS_LIST_FLAGS,
  PROMPTS_SAVE_FLAGS,
  PROMPTS_SCOPE_FLAG,
  PROMPTS_USE_FLAGS,
  SHARE_FLAGS,
  SHARING_BASE_FLAGS,
} from '../../shared/sharingFlags'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { parseSkillInvocation } from '../../shared/mentions'
import type { SavedPrompt } from '../../shared/prompts'
import type { ShareRequest } from '../../shared/share'

interface LocalOptions {
  readonly cwd: string | undefined
  readonly json: boolean
}
export type SharingCommand =
  | (LocalOptions & {
      readonly command: 'share'
      readonly request: ShareRequest
      readonly exportedAt: string | undefined
      readonly confirmation: string | undefined
      readonly out: string | undefined
      readonly destinationExplicit: boolean
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
      /** Scripted variable values (`--var name=value`, repeatable). */
      readonly vars: ReadonlyMap<string, string>
      /** A script's explicit confirmation, without the interactive review. */
      readonly confirmed: boolean
    })

export function localArgumentError(argument: string): Error {
  return new Error(fill(UI_TEXT.acpUnknownArgument, { argument }))
}

/** The accepted values behind the sharing flags; the help facts read these. */
export const SHARE_MODES = ['full', 'conversation'] as const
export const SHARE_FORMATS = ['md', 'html', 'json'] as const
export const SHARE_DESTINATIONS = ['copy', 'file', 'browser'] as const
export const PROMPT_SCOPES = ['user', 'workspace'] as const
export const PROMPT_CHATS = ['active', 'new'] as const
/** The parser-effective defaults behind the sharing enum facts. */
export const SHARING_DEFAULTS = {
  mode: 'conversation',
  format: 'md',
  scope: 'user',
  chat: 'active',
} as const

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
    ...SHARING_BASE_FLAGS,
    ...(isShare && SHARE_FLAGS),
    ...(root === 'prompts' && action !== 'list' && PROMPTS_SCOPE_FLAG),
    ...(action === 'list' && PROMPTS_LIST_FLAGS),
    ...(action === 'save' && PROMPTS_SAVE_FLAGS),
    ...(action === 'use' && PROMPTS_USE_FLAGS),
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
  const isJson = values['json'] === true
  const [id, ...extra] = positionals
  if (extra.length > 0) throw localArgumentError(extra.join(' '))
  if (action === 'list' && root === 'prompts' && id === undefined) {
    return {
      command: 'prompts',
      action,
      cwd,
      json: isJson,
      search: flag('search') ?? '',
      tag: flag('tag'),
    }
  }
  const scope = oneOf(flag('scope') ?? SHARING_DEFAULTS.scope, PROMPT_SCOPES)
  const title = flag('title')
  if (action === 'save' && root === 'prompts' && id === undefined && title !== undefined) {
    return {
      command: 'prompts',
      action,
      cwd,
      json: isJson,
      title,
      scope,
      tags: listFlag('tag'),
    }
  }
  if (action === 'use' && root === 'prompts' && id !== undefined) {
    const vars = new Map<string, string>()
    for (const entry of listFlag('var')) {
      const separator = entry.indexOf('=')
      if (separator <= 0) throw localArgumentError(`--var ${entry}`)
      vars.set(entry.slice(0, separator), entry.slice(separator + 1))
    }
    return {
      command: 'prompts',
      action,
      cwd,
      json: isJson,
      promptId: id,
      scope,
      chat: oneOf(flag('chat') ?? SHARING_DEFAULTS.chat, PROMPT_CHATS),
      vars,
      confirmed: values['confirm'] === true,
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
  const destinationFlag = flag('destination')
  let selectedDestination = destinationFlag
  if (selectedDestination === 'save') selectedDestination = 'file'
  if (selectedDestination === 'open') selectedDestination = 'browser'
  const destination = oneOf(
    selectedDestination ?? (flag('out') === undefined ? 'copy' : 'file'),
    SHARE_DESTINATIONS,
  )
  if (destination !== 'file' && flag('out') !== undefined) throw localArgumentError('--out')
  const common = {
    mode: oneOf(flag('mode') ?? SHARING_DEFAULTS.mode, SHARE_MODES),
    format: oneOf(flag('format') ?? SHARING_DEFAULTS.format, SHARE_FORMATS),
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
    json: isJson,
    request,
    exportedAt: flag('exported-at'),
    confirmation: flag('confirm'),
    out: flag('out'),
    destinationExplicit: destinationFlag !== undefined,
  }
}

/** Our slash syntax, not a shell: quoted arguments, then verbatim save text after ` -- `. */
export function parseSharingSlash(text: string, sessionId: string) {
  const invocation = parseSkillInvocation(text, new Set(['share', 'prompt']))
  if (invocation === undefined) return
  const tokens: string[] = []
  let body: string | undefined
  let remaining = text.trimStart().slice(1).trimStart()
  while (remaining !== '') {
    const token = /^(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s"']+))(?=\s|$)/.exec(remaining)
    if (token === null) throw localArgumentError(`/${invocation.selector}`)
    if (token[3] === '--' && remaining.length > token[0].length) {
      const delimiterLength = remaining.startsWith('\r\n', token[0].length) ? 2 : 1
      body = remaining.slice(token[0].length + delimiterLength)
      break
    }
    const value: unknown =
      token[1] === undefined ? (token[2] ?? token[3]) : JSON.parse(`"${token[1]}"`)
    if (typeof value !== 'string') throw localArgumentError(`/${invocation.selector}`)
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
    throw localArgumentError(`/${invocation.selector}`)
  }
  return { command, body }
}

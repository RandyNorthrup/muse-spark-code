// The three universal checks on a pasted provider key (PLAN.md D123):
// blank is refused (nothing can be sent); inner whitespace, a URL, a
// file path or placeholder text each raises a question the person
// answers ("use it anyway?"), never a dead end. No per-provider prefix
// or length is consulted: those froze (notably Gemini's `AIza`, which a
// working `AQ.` key failed) and the provider's own answer to the free
// key test decides instead. Pure. This module stays small on purpose:
// the panel bundle reads it with the password box, while the presets'
// data (origins, formats, key tests) stays in the providers chunk.

import { UI_TEXT } from '../../shared/l10n/text'

/**
 * Why a pasted value is worth a question before it is sent. Each notice
 * is true for every provider and protects against pasting the wrong
 * thing; each is answered ("use it anyway?"), never a dead end.
 */
export type ProviderKeyNotice = 'whitespace' | 'url' | 'path' | 'placeholder'

/** A pasted key: fine, blank, or carrying one question for the person. */
export type ProviderKeyInspection = 'ok' | 'empty' | ProviderKeyNotice

const KEY_PATH_PATTERN = /^(?:[/\\~]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\\\\)/
// Obvious non-keys: the field's own placeholder words, masked stars, and
// angle-bracket slots (`YOUR_API_KEY`, `xxx`, `***`, `<api-key>`,
// `paste-key-here`). Matched whole-value and case-insensitively; a real
// key carrying one of these words among other characters still passes.
const KEY_PLACEHOLDER_PATTERN =
  /^(?:your[_\s-]*api[_\s-]*key|your[_\s-]*key|my[_\s-]*key|test[_\s-]*key|example(?:[_\s-]*key)?|sample(?:[_\s-]*key)?|demo(?:[_\s-]*key)?|placeholder|changeme|paste[_\s-]*key[_\s-]*here|insert[_\s-]*key[_\s-]*here|enter[_\s-]*key[_\s-]*here|your[_\s-]*key[_\s-]*here|x{3,}|\*{2,}|<[^<>]+>)$/i

/**
 * The three universal checks on a pasted provider key (pure): blank is
 * refused (nothing can be sent); inner whitespace, a URL, a file path
 * or placeholder text each raises a question the person answers.
 */
export function inspectProviderKey(candidate: string): ProviderKeyInspection {
  const trimmed = candidate.trim()
  if (trimmed === '') {
    return 'empty'
  }
  if (/\s/.test(trimmed)) {
    return 'whitespace'
  }
  if (trimmed.includes('://')) {
    return 'url'
  }
  if (KEY_PATH_PATTERN.test(trimmed)) {
    return 'path'
  }
  return KEY_PLACEHOLDER_PATTERN.test(trimmed) ? 'placeholder' : 'ok'
}

/**
 * The question for one inspection notice ("use it anyway?"), read at use
 * time so the installed language is the one shown.
 */
export function providerKeyNoticeText(notice: ProviderKeyNotice): string {
  switch (notice) {
    case 'whitespace': {
      return UI_TEXT.providerKeyNoticeWhitespace
    }
    case 'url': {
      return UI_TEXT.providerKeyNoticeUrl
    }
    case 'path': {
      return UI_TEXT.providerKeyNoticePath
    }
    case 'placeholder': {
      return UI_TEXT.providerKeyNoticePlaceholder
    }
  }
}

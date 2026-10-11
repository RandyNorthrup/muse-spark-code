// The composer menus' listbox wiring (M38): the ids the textarea's
// aria-controls and aria-activedescendant name. The menu bodies load on
// first open; these strings stay in the startup closure with the composer.
export const SLASH_LISTBOX_ID = 'slash-listbox'
export const SLASH_OPTION_ID_PREFIX = 'slash-option-'

export function slashOptionId(index: number): string {
  return `${SLASH_OPTION_ID_PREFIX}${String(index)}`
}

export const MENTION_OPTION_ID_PREFIX = 'mention-option-'

export function mentionOptionId(index: number): string {
  return `${MENTION_OPTION_ID_PREFIX}${String(index)}`
}

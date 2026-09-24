// The prompt's "/" list (M38): the slash commands matching what follows the
// slash, best match first. Keyboard handling stays in the composer (the
// textarea keeps focus), as for the `@` list; this renders the rows and the
// active one.

import { UI_TEXT } from '../../shared/constants'
import type { SlashCommand } from '../../shared/slashCommands'
import { MenuOption } from './MenuOption'

export interface SlashMenuProps {
  readonly items: readonly SlashCommand[]
  readonly activeIndex: number
  readonly onSelect: (command: SlashCommand) => void
  readonly onHover: (index: number) => void
}

export const SLASH_LISTBOX_ID = 'slash-listbox'

export function slashOptionId(index: number): string {
  return `slash-option-${String(index)}`
}

export function SlashMenu({ items, activeIndex, onSelect, onHover }: SlashMenuProps) {
  return (
    <div className="mention-menu slash-menu">
      <div className="palette-group-title" aria-hidden="true">
        {UI_TEXT.groupSlashCommands}
      </div>
      {items.length === 0 ? (
        <p className="menu-empty">{UI_TEXT.slashNoMatches}</p>
      ) : (
        <ul id={SLASH_LISTBOX_ID} role="listbox" aria-label={UI_TEXT.groupSlashCommands}>
          {items.map((item, index) => (
            <MenuOption
              key={item.name}
              id={slashOptionId(index)}
              isActive={index === activeIndex}
              onHover={() => {
                onHover(index)
              }}
              onSelect={() => {
                onSelect(item)
              }}
            >
              <span className="palette-item-text">
                <span className="palette-item-label">/{item.name}</span>
                {item.detail === undefined ? null : (
                  <span className="palette-item-detail">{item.detail}</span>
                )}
              </span>
            </MenuOption>
          ))}
        </ul>
      )}
    </div>
  )
}

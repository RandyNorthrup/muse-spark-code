// The `@` autocomplete list. Keyboard handling stays in the composer (the
// textarea keeps focus); this renders the rows and the active one.

import { UI_TEXT } from '../../shared/constants'
import type { MentionItem } from '../../shared/protocol'
import { FileIcon, FolderIcon } from './icons'
import { MenuOption } from './MenuOption'

export interface MentionMenuProps {
  readonly items: readonly MentionItem[]
  readonly activeIndex: number
  readonly onSelect: (item: MentionItem) => void
  readonly onHover: (index: number) => void
}

export function mentionOptionId(index: number): string {
  return `mention-option-${String(index)}`
}

export function MentionMenu({ items, activeIndex, onSelect, onHover }: MentionMenuProps) {
  return (
    <div className="mention-menu">
      {items.length === 0 ? (
        <p className="menu-empty">{UI_TEXT.mentionNoMatches}</p>
      ) : (
        <ul id="mention-listbox" role="listbox" aria-label={UI_TEXT.mentionMenuLabel}>
          {items.map((item, index) => (
            <MenuOption
              key={item.path}
              id={mentionOptionId(index)}
              isActive={index === activeIndex}
              onHover={() => {
                onHover(index)
              }}
              onSelect={() => {
                onSelect(item)
              }}
            >
              {item.isFolder ? <FolderIcon /> : <FileIcon />}
              <span className="menu-item-label">{item.path}</span>
            </MenuOption>
          ))}
        </ul>
      )}
    </div>
  )
}

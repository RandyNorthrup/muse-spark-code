// The `@` autocomplete list. Keyboard handling stays in the composer (the
// textarea keeps focus); this renders the rows and the active one.

import { UI_TEXT } from '../../shared/constants'
import type { MentionItem } from '../../shared/protocol'
import { FileIcon, FolderIcon } from './icons'

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
            <li
              key={item.path}
              id={mentionOptionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'menu-item menu-item-active' : 'menu-item'}
              onMouseEnter={() => {
                onHover(index)
              }}
              onMouseDown={(event) => {
                // Keep the textarea focused; the click still selects.
                event.preventDefault()
              }}
              onClick={() => {
                onSelect(item)
              }}
            >
              {item.isFolder ? <FolderIcon /> : <FileIcon />}
              <span className="menu-item-label">{item.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

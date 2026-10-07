// M17's highlighted-text actions, presented by M87's reusable radial menu.
import { CHAT_REFERENCE_INTENTS, UI_TEXT } from '../../shared/constants'
import type { ChatReference } from '../../shared/protocol'
import type { MenuPoint } from '../gooeyLayout'
import { GooeyMenu } from './GooeyMenu'
import { CopyIcon, PlanIcon, ReplyIcon } from './icons'

export type QuoteIntent = Exclude<ChatReference['intent'], 'reply'>

export interface QuoteMenuProps {
  readonly onChoose: (intent: QuoteIntent) => void
  readonly onCopy: () => void
  readonly onClose: () => void
  readonly origin?: MenuPoint | undefined
}

const [, QUESTION, COMMENT] = CHAT_REFERENCE_INTENTS

export function QuoteMenu({ onChoose, onCopy, onClose, origin }: QuoteMenuProps) {
  return (
    <div className="quote-menu">
      <GooeyMenu
        keepFocus
        label={UI_TEXT.quoteMenuLabel}
        {...(origin === undefined ? {} : { origin })}
        onClose={onClose}
        items={[
          { id: 'copy', label: UI_TEXT.quoteCopy, icon: <CopyIcon />, onSelect: onCopy },
          {
            id: 'question',
            label: UI_TEXT.askAboutThis,
            icon: <ReplyIcon />,
            onSelect: () => {
              onChoose(QUESTION)
            },
          },
          {
            id: 'comment',
            label: UI_TEXT.commentOnThis,
            icon: <PlanIcon />,
            onSelect: () => {
              onChoose(COMMENT)
            },
          },
        ]}
      />
    </div>
  )
}

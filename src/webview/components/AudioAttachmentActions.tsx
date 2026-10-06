// D85.5 sound controls, loaded only when a media chip has routing options.
import type { AudioAction, AudioRouteOptions } from '../../shared/audioRouting'
import { createElement } from 'react'

interface AudioAttachmentActionsProps {
  readonly options: AudioRouteOptions
  readonly selected: AudioAction | undefined
  readonly onAction: (action: AudioAction) => void
}

export default function AudioAttachmentActions({
  options,
  selected,
  onAction,
}: AudioAttachmentActionsProps) {
  return options.actions.map((action) =>
    createElement(
      'button',
      {
        key: action,
        type: 'button',
        'aria-pressed': selected === action,
        onClick: () => {
          onAction(action)
        },
      },
      options.labels[action],
    ),
  )
}

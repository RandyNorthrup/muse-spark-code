// Muse Desktop (M111, D91.13) lane BP: the Output view. One log per
// channel, newest at the tail; the view follows the tail until the
// person scrolls up. Channels clip to their megabyte oldest-first, and
// the clipped count is said, never silent.

import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { plural } from '../../../shared/l10n/text'
import type { OutputSnapshot } from '../../../shared/desktop/bridge'

export interface OutputViewProps {
  readonly snapshot: OutputSnapshot
  readonly onClear: (channel: string | undefined) => void
}

export function OutputView(properties: OutputViewProps) {
  const { snapshot, onClear } = properties
  const [channel, setChannel] = useState<string | undefined>(undefined)
  const [stick, setStick] = useState(true)
  const log = useRef<HTMLPreElement>(null)
  const selected =
    snapshot.channels.find((entry) => entry.channel === channel) ?? snapshot.channels[0]

  useEffect(() => {
    const element = log.current
    if (stick && element !== null) element.scrollTop = element.scrollHeight
  }, [selected?.text, stick])

  if (selected === undefined) {
    return <p className="muse-panel-empty">{UI_TEXT.desktop.workbenchNoOutput}</p>
  }

  return (
    <div className="muse-panel-output">
      <div className="muse-panel-output-bar">
        <label className="muse-panel-output-picker">
          {UI_TEXT.desktop.panelOutputChannel}
          <select
            value={selected.channel}
            onChange={(event) => {
              setChannel(event.currentTarget.value)
            }}
          >
            {snapshot.channels.map((entry) => (
              <option key={entry.channel} value={entry.channel}>
                {entry.channel}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          title={UI_TEXT.desktop.panelClearOutput}
          onClick={() => {
            onClear(selected.channel)
          }}
        >
          {UI_TEXT.desktop.panelClearOutput}
        </button>
      </div>
      {selected.truncatedChars > 0 ? (
        <p className="muse-panel-output-truncated">
          {plural(UI_TEXT.desktop.panelOutputTruncated, selected.truncatedChars)}
        </p>
      ) : null}
      <pre
        ref={log}
        className="muse-panel-output-log"
        dir="ltr"
        role="log"
        aria-live="off"
        onScroll={(event) => {
          const element = event.currentTarget
          setStick(element.scrollHeight - element.scrollTop - element.clientHeight <= 1)
        }}
      >
        {selected.text}
      </pre>
    </div>
  )
}

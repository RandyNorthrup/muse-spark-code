// Muse Desktop (M111, D91.13) lane BP: the Output store. The main process
// holds dev servers' and tasks' logs per named channel; suppliers append,
// the person clears, and the renderer replays the appended events. Each
// channel keeps at most a megabyte (D95's per-stream precedent), dropping
// the oldest characters and counting them, so a chatty server cannot grow
// the main process without bound. Until a supplier appends, every channel
// list is honestly empty.

import {
  DESKTOP_OUTPUT_APPEND_MAX_CHARS,
  DESKTOP_OUTPUT_CHANNEL_MAX_CHARS,
  DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS,
} from '../../src/shared/constants'
import type { OutputAppended, OutputCleared, OutputSnapshot } from '../../src/shared/desktop/bridge'
import { clipChannelTail } from '../../src/shared/desktop/panel'

interface OutputChannel {
  text: string
  truncatedChars: number
}

function checkChannel(channel: string): void {
  if (channel.length === 0 || channel.length > DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS) {
    throw new Error(
      `Refused: output channel names run 1 to ${String(DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS)} characters`,
    )
  }
}

export class OutputStore {
  private readonly channels = new Map<string, OutputChannel>()

  public constructor(
    private readonly events: {
      onAppended(frame: OutputAppended): void
      onCleared(frame: OutputCleared): void
    },
  ) {}

  /**
  Appends one chunk; an overlong name or chunk is refused by name to
  the caller, and the channel clips to its megabyte, oldest first.
  */
  public append(channel: string, text: string): void {
    checkChannel(channel)
    if (text.length > DESKTOP_OUTPUT_APPEND_MAX_CHARS) {
      throw new Error(
        `Refused: one output append carries at most ${String(DESKTOP_OUTPUT_APPEND_MAX_CHARS)} characters`,
      )
    }
    const previous = this.channels.get(channel) ?? { text: '', truncatedChars: 0 }
    const clipped = clipChannelTail(`${previous.text}${text}`, DESKTOP_OUTPUT_CHANNEL_MAX_CHARS)
    this.channels.set(channel, {
      text: clipped.text,
      truncatedChars: previous.truncatedChars + clipped.dropped,
    })
    this.events.onAppended({
      channel,
      text,
      truncatedChars: previous.truncatedChars + clipped.dropped,
    })
  }

  /** Clears one channel, or every channel when none is named. */
  public clear(channel?: string): void {
    if (channel !== undefined) checkChannel(channel)
    if (channel === undefined) this.channels.clear()
    else this.channels.delete(channel)
    this.events.onCleared(channel === undefined ? {} : { channel })
  }

  public snapshot(): OutputSnapshot {
    return {
      channels: [...this.channels].map(([channel, stored]) => ({
        channel,
        text: stored.text,
        truncatedChars: stored.truncatedChars,
      })),
    }
  }
}

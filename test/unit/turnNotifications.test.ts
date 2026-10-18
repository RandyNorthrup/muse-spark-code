// The background turn notifier (M82): a notice the window never showed is a
// recorded failure, named by its kind, never by the editor's message.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BackgroundNotifier,
  type AttentionNotice,
} from '../../src/host/conversation/turnNotifications'
import { createLogger, type Logger } from '../../src/host/logger'

function captureLogger(into: string[]): Logger {
  return createLogger({
    trace: (message: string) => {
      into.push(`trace ${message}`)
    },
    info: (message: string) => {
      into.push(`info ${message}`)
    },
    warn: (message: string) => {
      into.push(`warn ${message}`)
    },
    error: (message: string) => {
      into.push(`error ${message}`)
    },
  })
}

async function waitFor(lines: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 100 && lines.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('BackgroundNotifier', () => {
  it('records a refused notice by kind, without the failure message', async () => {
    const lines: string[] = []
    // A real refusal: reading a file that is not there fails with a genuine
    // ENOENT whose message names the missing path.
    const missing = path.join('temp', 'turn-notifier-never-written.json')
    let isRevealed = false
    const notifier = new BackgroundNotifier({
      isEnabled: () => true,
      isWindowFocused: () => false,
      show: async () => {
        await readFile(missing, 'utf8')
        return true
      },
      log: captureLogger(lines),
    })
    const notice: AttentionNotice = { key: 'session:turn:1', message: 'A turn ended.' }
    notifier.notify(notice, () => {
      isRevealed = true
    })
    await waitFor(lines)
    expect(isRevealed).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('The background notice failed')
    expect(lines[0]).not.toContain(missing)
  })

  it('raises each key once, even when the notice fails', async () => {
    const lines: string[] = []
    let shows = 0
    const notifier = new BackgroundNotifier({
      isEnabled: () => true,
      isWindowFocused: () => false,
      show: () => {
        shows += 1
        return Promise.reject(new Error('gone'))
      },
      log: captureLogger(lines),
    })
    const notice: AttentionNotice = { key: 'session:turn:2', message: 'A turn ended.' }
    notifier.notify(notice, () => undefined)
    notifier.notify(notice, () => undefined)
    await waitFor(lines)
    expect(shows).toBe(1)
  })
})

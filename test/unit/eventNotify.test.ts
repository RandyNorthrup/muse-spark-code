import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { notify } from '../../src/core/events/notify'
import type { CoreLogger } from '../../src/core/logging'

function logger(into: string[]): CoreLogger {
  return {
    trace: (message) => {
      into.push(message)
    },
    info: (message) => {
      into.push(message)
    },
    warn: (message) => {
      into.push(message)
    },
    error: (message) => {
      into.push(message)
    },
  }
}

describe('notify', () => {
  it('runs every listener past a throwing one and tells the asking session once', () => {
    const seen: string[] = []
    const messages: string[] = []
    const diagnostics: AgentEvent[] = []
    notify(
      [
        () => {
          seen.push('first')
        },
        () => {
          throw new Error('listener blew up')
        },
        () => {
          seen.push('third')
        },
      ],
      undefined,
      logger(messages),
      'modelApi.event',
      (diagnostic) => {
        diagnostics.push(diagnostic)
      },
    )
    expect(seen).toEqual(['first', 'third'])
    expect(messages).toEqual(['Backend notification listener failed: modelApi.event'])
    expect(diagnostics).toEqual([
      { type: 'backendNotice', level: 'error', text: UI_TEXT.backendListenerFailed },
    ])
  })

  it('still runs every listener when the log sink itself throws', () => {
    const seen: string[] = []
    const ignored: string[] = []
    const broken: CoreLogger = {
      trace: (message) => {
        ignored.push(message)
      },
      info: (message) => {
        ignored.push(message)
      },
      warn: (message) => {
        ignored.push(message)
      },
      error: () => {
        throw new Error('sink blew up')
      },
    }
    notify(
      [
        () => {
          throw new Error('listener blew up')
        },
        () => {
          seen.push('second')
        },
      ],
      undefined,
      broken,
      'modelApi.event',
    )
    expect(seen).toEqual(['second'])
  })
})

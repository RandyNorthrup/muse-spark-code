// B17: a judge result dropped at its fence must read as dropped, never as
// a clean bill. Real JudgeUse with values passed in as data; the runner
// settles through the real entry store it is handed.
import { describe, expect, it } from 'vitest'
import { JudgeUse, type JudgeUseDeps } from '../../src/core/judge/use'
import { UI_TEXT } from '../../src/shared/constants'
import type {
  JudgeEntryHandle,
  JudgeEntryParts,
  JudgeEntryStore,
} from '../../src/core/judge/entries'

function action(): JudgeEntryParts {
  return {
    backend: 'test',
    sessionId: 's1',
    turnId: 't1',
    tool: 'bash',
    args: { command: 'rm -rf /tmp/x' },
  }
}

function deps(
  settle: (entries: JudgeEntryStore, key: JudgeEntryHandle) => void,
  errors: unknown[],
): JudgeUseDeps {
  return {
    isOn: () => true,
    createRunner: (entries) => ({
      judge: (job) => {
        settle(entries, job.entryKey)
      },
    }),
    question: () => ({ id: 'risk.destructive', kind: 'noul', text: 'is it destructive?' }),
    prepare: () => Promise.resolve(true),
    onError: (error) => {
      errors.push(error)
    },
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('judge fence dropped()', () => {
  it('reads dropped when the batch settles failed', async () => {
    const errors: unknown[] = []
    const judge = new JudgeUse(
      deps((entries, key) => {
        entries.settle(key, 'failed')
      }, errors),
    )
    const fence = judge.start(action(), 'state')
    expect(fence).toBeDefined()
    await flush()
    expect(fence?.read()).toBeUndefined()
    expect(fence?.dropped()).toBe(true)
  })

  it('reads dropped when the batch never settles', async () => {
    const errors: unknown[] = []
    const judge = new JudgeUse(
      deps(() => {
        // A late result arrives after the fence: nothing settles.
      }, errors),
    )
    const fence = judge.start(action(), 'state')
    await flush()
    expect(fence?.read()).toBeUndefined()
    expect(fence?.dropped()).toBe(true)
  })

  it('reads kept when the batch judges caution', async () => {
    const errors: unknown[] = []
    const judge = new JudgeUse(
      deps((entries, key) => {
        entries.settle(key, 'caution')
      }, errors),
    )
    const fence = judge.start(action(), 'state')
    await flush()
    expect(fence?.read()).toBe('caution')
    expect(fence?.dropped()).toBe(false)
  })

  it('reads kept when the batch judges none', async () => {
    const errors: unknown[] = []
    const judge = new JudgeUse(
      deps((entries, key) => {
        entries.settle(key, 'none')
      }, errors),
    )
    const fence = judge.start(action(), 'state')
    await flush()
    expect(fence?.read()).toBe('none')
    expect(fence?.dropped()).toBe(false)
  })

  it('names the missing advisory for the approval card', () => {
    expect(UI_TEXT.judgeAdvisoryMissing).toContain('no advisory')
  })
})

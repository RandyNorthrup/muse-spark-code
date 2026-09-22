import { describe, expect, it, vi } from 'vitest'
import {
  type MentionPickItem,
  type MentionQuickPick,
  pickMentionFile,
} from '../../src/host/mention/mentionQuickPick'
import { EventEmitter } from './mocks/vscode'

class FakeQuickPick implements MentionQuickPick {
  public items: readonly MentionPickItem[] = []
  public placeholder: string | undefined = undefined
  public matchOnDescription = true
  public value = ''
  public selectedItems: readonly MentionPickItem[] = []
  public readonly valueChanges = new EventEmitter<string>()
  public readonly onDidChangeValue = this.valueChanges.event
  public readonly accepted = new EventEmitter<void>()
  public readonly onDidAccept = this.accepted.event
  public readonly hidden = new EventEmitter<void>()
  public readonly onDidHide = this.hidden.event
  public readonly show = vi.fn()
  public readonly dispose = vi.fn()

  public hide(): void {
    this.hidden.fire()
  }
}

function setup() {
  const picker = new FakeQuickPick()
  const search = vi.fn((query: string, _limit: number) =>
    Promise.resolve(
      ['src/app.ts', 'src/apple.ts', 'README.md']
        .filter((path) => path.includes(query))
        .map((path) => ({ path, isFolder: false })),
    ),
  )
  const result = pickMentionFile({
    createQuickPick: () => picker,
    mentions: { search },
    limit: 50,
    placeholder: 'Mention file…',
  })
  return { picker, search, result }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

describe('pickMentionFile', () => {
  it('shows the index, refreshes on typing, and resolves with the accepted path', async () => {
    const { picker, search, result } = setup()
    await flush()
    expect(picker.show).toHaveBeenCalledOnce()
    expect(picker.placeholder).toBe('Mention file…')
    expect(picker.matchOnDescription).toBe(false)
    expect(picker.items.map((item) => item.label)).toEqual([
      'src/app.ts',
      'src/apple.ts',
      'README.md',
    ])
    picker.valueChanges.fire('app')
    await flush()
    expect(search).toHaveBeenLastCalledWith('app', 50)
    expect(picker.items.map((item) => item.path)).toEqual(['src/app.ts', 'src/apple.ts'])
    const [, second] = picker.items
    expect(second).toBeDefined()
    picker.selectedItems = second === undefined ? [] : [second]
    picker.accepted.fire()
    await expect(result).resolves.toBe('src/apple.ts')
    expect(picker.dispose).toHaveBeenCalledOnce()
  })

  it('resolves undefined when dismissed', async () => {
    const { picker, result } = setup()
    await flush()
    picker.hide()
    await expect(result).resolves.toBeUndefined()
  })
})

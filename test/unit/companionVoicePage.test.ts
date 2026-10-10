// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { companionVoiceInputSchema } from '../../src/shared/companionVoice'
import { UI_TEXT } from '../../src/shared/l10n/text'

interface ChannelDouble {
  posts: unknown[]
  event: ((input: unknown) => Promise<void>) | undefined
  ready: (() => void) | undefined
}

const mockDouble: ChannelDouble = vi.hoisted((): ChannelDouble => ({
  posts: [],
  event: undefined,
  ready: undefined,
}))

vi.mock('../../src/webview/companionChannel', () => ({
  companionPost: (message: unknown) => {
    mockDouble.posts.push(message)
    return Promise.resolve()
  },
  companionEvents: (options: {
    readonly ready: () => void
    readonly event: (input: unknown) => Promise<void>
  }) => {
    mockDouble.ready = options.ready
    mockDouble.event = options.event
    return new Promise<void>(() => {
      // The page holds this stream open for its lifetime.
    })
  },
}))

class FakeTrack {
  readyState: 'live' | 'ended' = 'live'

  stop(): void {
    this.readyState = 'ended'
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()]

  getTracks(): FakeTrack[] {
    return this.tracks
  }
}

class FakeRecorder extends EventTarget {
  state = 'recording'

  start(): void {
    // Frames arrive only when the test dispatches them.
  }

  stop(): void {
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  }
}

function installDom(): void {
  document.body.innerHTML = [
    '<main>',
    '<label for="engine">engine</label>',
    '<select id="engine"><option value="system">Free</option></select>',
    '<div class="actions">',
    '<button id="dictate">Dictate</button>',
    '<button id="stop" disabled>Stop</button>',
    '<button id="cancel" disabled>Cancel</button>',
    '</div>',
    '<p id="status" role="status" aria-live="polite"></p>',
    '<label for="prompt">prompt</label>',
    '<textarea id="prompt"></textarea>',
    '<button id="send" disabled>Send</button>',
    '<dialog id="consent" aria-labelledby="consent-title" aria-describedby="consent-detail">',
    '<h2 id="consent-title"></h2>',
    '<p id="consent-detail" class="consent-detail"></p>',
    '<div class="actions">',
    '<button id="once">once</button>',
    '<button id="always">always</button>',
    '<button id="deny">deny</button>',
    '</div>',
    '</dialog>',
    '</main>',
  ].join('')
}

function element<T extends HTMLElement>(selector: string, kind: new () => T): T {
  const node = document.querySelector(selector)
  if (!(node instanceof kind)) throw new Error(`missing ${selector}`)
  return node
}

async function bootPage(): Promise<void> {
  vi.resetModules()
  mockDouble.posts = []
  installDom()
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => getUserMedia() },
    configurable: true,
  })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  await import('../../src/webview/voice/companion')
  const ready = mockDouble.ready
  if (ready === undefined) throw new Error('event channel not installed')
  ready()
}

async function flush(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
}

async function emit(input: unknown): Promise<void> {
  const event = mockDouble.event
  if (event === undefined) throw new Error('event channel not installed')
  await event(input)
}

function begins(): { id: string }[] {
  return mockDouble.posts.flatMap((post) => {
    const parsed = companionVoiceInputSchema.parse(post)
    return parsed.type === 'begin' ? [{ id: parsed.id }] : []
  })
}

const getUserMedia = vi.fn<() => Promise<FakeStream>>(() => Promise.resolve(new FakeStream()))

beforeEach(() => {
  getUserMedia.mockImplementation(() => Promise.resolve(new FakeStream()))
  if (typeof HTMLDialogElement === 'undefined') return
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('voice companion page without a browser', () => {
  it('a replaced capture’s late microphone rejection leaves the new recording live', async () => {
    // RVCMICCOMP finding 3: the record() rejection handler was not fenced to
    // its generation, so a stale denial stopped the replacement's tracks and
    // posted a host-wide cancel. The replacement must keep listening.
    const { promise: firstGate, reject: rejectFirst } = Promise.withResolvers<FakeStream>()
    const streams: FakeStream[] = []
    let calls = 0
    getUserMedia.mockImplementation(() => {
      calls += 1
      if (calls === 1) return firstGate
      const stream = new FakeStream()
      streams.push(stream)
      return Promise.resolve(stream)
    })
    await bootPage()
    const status = element('#status', HTMLParagraphElement)
    element('#dictate', HTMLButtonElement).click()
    await flush()
    expect(begins()).toHaveLength(1)
    const captureA = begins()[0]
    if (captureA === undefined) throw new Error('first begin absent')
    await emit({ type: 'ready', id: captureA.id, ticket: randomUUID(), paid: false })
    await flush()
    expect(calls).toBe(1)
    element('#cancel', HTMLButtonElement).click()
    await flush()
    element('#dictate', HTMLButtonElement).click()
    await flush()
    expect(begins()).toHaveLength(2)
    const captureB = begins()[1]
    if (captureB === undefined) throw new Error('second begin absent')
    await emit({ type: 'ready', id: captureB.id, ticket: randomUUID(), paid: false })
    await flush()
    expect(status.textContent).toBe(UI_TEXT.dictationListening)
    const postsBefore = mockDouble.posts.length
    rejectFirst(new Error('late denial'))
    await flush()
    expect(status.textContent).toBe(UI_TEXT.dictationListening)
    expect(streams).toHaveLength(1)
    expect(streams[0]?.tracks.every((track) => track.readyState === 'live')).toBe(true)
    expect(mockDouble.posts).toHaveLength(postsBefore)
  })

  it('typing after an empty reviewed prompt re-enables Send', async () => {
    // RVCMICCOMP finding 5: refusing an empty Send disabled the button, and
    // no input listener recalculated it, so corrected text stayed unsendable.
    await bootPage()
    const prompt = element('#prompt', HTMLTextAreaElement)
    const send = element('#send', HTMLButtonElement)
    const status = element('#status', HTMLParagraphElement)
    element('#dictate', HTMLButtonElement).click()
    await flush()
    const capture = begins()[0]
    if (capture === undefined) throw new Error('begin absent')
    const ticket = randomUUID()
    await emit({ type: 'ready', id: capture.id, ticket, paid: false })
    await flush()
    await emit({ type: 'transcript', ticket, text: 'first phrase', paid: false, seconds: 1 })
    await flush()
    expect(prompt.value).toContain('first phrase')
    expect(send.disabled).toBe(false)
    prompt.value = ' '.repeat(3)
    send.click()
    await flush()
    await emit({ type: 'error', text: 'refused' })
    await flush()
    expect(status.textContent).toBe(UI_TEXT.companionVoiceFailed)
    expect(send.disabled).toBe(true)
    prompt.value = 'Corrected phrase'
    prompt.dispatchEvent(new Event('input', { bubbles: true }))
    expect(send.disabled).toBe(false)
    send.click()
    await flush()
    expect(mockDouble.posts.at(-1)).toEqual({
      type: 'send',
      text: 'Corrected phrase',
    })
  })
})

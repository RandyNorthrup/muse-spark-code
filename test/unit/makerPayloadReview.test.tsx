// @vitest-environment jsdom
import { createHash, randomBytes } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { runInNewContext } from 'node:vm'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MAKER_REVIEW_SMALL_ROWS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { canonicalPayload, outgoingPayloadBytes } from '../../src/core/maker/canonicalPayload'
import { summarizePayload } from '../../src/core/maker/payloadSummary'
import type { ApprovalRequest } from '../../src/shared/makerProtocol'
import { ApprovalDialog } from '../../src/webview/maker/ApprovalDialog'
import { PayloadReview } from '../../src/webview/maker/PayloadReview'
import { findPayloadMatch } from '../../src/webview/maker/payloadSearch'
import { MakerSurface } from '../../src/webview/maker/MakerSurface'
import {
  installMakerBrowser,
  uiApproval,
  uiBridge,
  MAKER_UI_STATE,
  MAKER_UI_ID,
  MAKER_UI_MACHINE,
} from './helpers/makerUi'

const browser = { visible: installMakerBrowser() }
const searchWorkers: {
  deliver: (data: unknown) => void
  terminate: (this: { terminations: number }) => void
  terminations: number
}[] = []

beforeEach(() => {
  browser.visible = installMakerBrowser()
  searchWorkers.length = 0
  const blobs = new Map<string, NodeBlob>()
  const urlClass = class extends URL {
    static override createObjectURL(blob: Blob | MediaSource) {
      if (!(blob instanceof NodeBlob)) throw new TypeError('Unexpected worker blob')
      const url = `blob:simulator-${String(blobs.size)}`
      blobs.set(url, blob)
      return url
    }
    static override revokeObjectURL(url: string) {
      blobs.delete(url)
    }
  }
  const workerClass = class {
    listeners = new Map<string, (event: { data: unknown }) => void>()
    terminations = 0
    terminate = () => {
      this.terminations += 1
    }
    constructor(url: string) {
      searchWorkers.push(this)
      const blob = blobs.get(url)
      if (blob === undefined) throw new Error('Missing worker blob')
      void blob.text().then((source) => {
        setTimeout(() => {
          if (this.terminations > 0) return
          runInNewContext(source, {
            postMessage: (data: unknown) => {
              this.deliver(data)
            },
          })
        }, 0)
      })
    }
    addEventListener(type: string, callback: (event: { data: unknown }) => void) {
      this.listeners.set(type, callback)
    }
    deliver(data: unknown) {
      this.listeners.get('message')?.({ data })
    }
  }
  Object.defineProperties(globalThis, {
    Blob: { value: NodeBlob, configurable: true },
    URL: { value: urlClass, configurable: true },
    Worker: { value: workerClass, configurable: true },
  })
})
afterEach(() => {
  cleanup()
  setUiText(EN, 'en')
})
const hash = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex')
const UNSAFE_ANALYSIS = {
  ...uiApproval().analysis,
  bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 900, y: 0, z: 0 } },
}
const prepare = (content: string, encoding: 'text' | 'hex' = 'text', width = 240) =>
  canonicalPayload(
    outgoingPayloadBytes(content, encoding),
    width,
    () => 8,
    new AbortController().signal,
  )

it('CR, LF, TAB, NUL and ESC are visible, and the digest covers exact outgoing bytes', async () => {
  const content = 'G1 X1\r\n\t\0\u{1B}'
  const payload = await prepare(content)
  expect(payload.rows.map((row) => row.text).join('')).toBe('G1 X1␍␊␉␀␛')
  expect(payload.digest).toBe(hash(content))
  expect(payload.digest).not.toBe(hash(content.replaceAll('\r', '')))
})
it('invalid UTF-8, bidi, zero-width and combining marks cannot hide bytes', async () => {
  const payload = await prepare('ff7f61e2808be280aecc8109', 'hex')
  expect(payload.rows.map((row) => row.text).join('')).toBe(
    String.raw`\xff\x7fa\xe2\x80\x8b\xe2\x80\xae\xcc\x81␉`,
  )
  const literal = await prepare(String.raw`\xFF␍`)
  expect(literal.rows.map((row) => row.text).join('')).toBe(String.raw`\\xFF\xe2\x90\x8d`)
})
it('BOM bytes at the start and inside a payload are always visible', async () => {
  const payload = await prepare('efbbbf4d313035efbbbf0d0a', 'hex')
  expect(payload.rows.map((row) => row.text).join('')).toBe(
    String.raw`\xef\xbb\xbfM105\xef\xbb\xbf␍␊`,
  )
})
it('random byte strings round-trip from the canonical rendering with every byte accounted for', async () => {
  const samples = [
    Uint8Array.from({ length: 256 }, (_, byte) => byte),
    new TextEncoder().encode('\u{FEFF}hello\\␍界\u{FEFF}\r\n'),
    ...Array.from({ length: 100 }, (_, index) => randomBytes(index * 2)),
  ]
  for (const bytes of samples) {
    const payload = await canonicalPayload(bytes, 64, () => 8, new AbortController().signal)
    const characters =
      payload.rows
        .map((row) => row.text)
        .join('')
        .match(/./gu) ?? []
    const restored: number[] = []
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index] ?? ''
      if (character === '\\') {
        if (characters[index + 1] === '\\') {
          restored.push(92)
          index += 1
        } else {
          expect(characters[index + 1]).toBe('x')
          restored.push(Number.parseInt(characters.slice(index + 2, index + 4).join(''), 16))
          index += 3
        }
      } else {
        const point = character.codePointAt(0) ?? 0
        restored.push(
          ...(point >= 0x24_00 && point < 0x24_20
            ? [point - 0x24_00]
            : new TextEncoder().encode(character)),
        )
      }
    }
    expect(Uint8Array.from(restored)).toEqual(Uint8Array.from(bytes))
  }
})
it.each([
  'M302',
  'M302 P',
  'M302 P2',
  'M302 S1',
  'M302 P0 S170',
  'M0302P2',
  'M211 S0',
  'M0211S0',
  'M121',
  'M80',
  'M81',
  '$20=0',
  '$21=0',
  'M564 S0',
  'M564 H0',
  'M570 H1 P0',
  'M143 H1 S999',
  'THERMAL_RUNAWAY OFF',
  'THERMAL_PROTECTION ENABLED=0',
  'VERIFY_HEATER ENABLE=0',
  'SET_KINEMATIC_POSITION X900',
  'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=999',
  'TEMPERATURE_WAIT SENSOR=heater_bed MINIMUM=999',
])('safety-sensitive command %s always needs the extra acknowledgement', async (content) => {
  const { send } = await approval(content)
  expect(screen.getByLabelText(UI_TEXT.makerAcknowledgeDangers)).toBeInTheDocument()
  act(() => {
    browser.visible()
  })
  expect(send).toBeDisabled()
  fireEvent.click(screen.getByLabelText(UI_TEXT.makerAcknowledgeDangers))
  expect(send).toBeEnabled()
})
it.each(['M104 S201', 'M109 R201', 'M140 S71', 'M190 R71', 'M141 S40', 'M191 R40'])(
  'over-limit or unconfigured heater %s needs acknowledgement',
  async (content) => {
    const summary = await summarizePayload(
      outgoingPayloadBytes(content, 'text'),
      uiApproval(),
      { extruder: 200, bed: 70 },
      new AbortController().signal,
    )
    expect(summary.highlights).toContainEqual(expect.objectContaining({ reason: 'temperature' }))
  },
)
it('long unbroken and wide Unicode tokens wrap to the measured width', async () => {
  const bytes = outgoingPayloadBytes('界'.repeat(80) + 'W'.repeat(1000), 'text')
  const payload = await canonicalPayload(
    bytes,
    64,
    (character) => (character === '界' ? 16 : 8),
    new AbortController().signal,
  )
  expect(
    payload.rows.every(
      (row) =>
        (row.text.match(/./gu) ?? []).reduce((size, c) => size + (c === '界' ? 16 : 8), 0) <= 64,
    ),
  ).toBe(true)
  expect(payload.rows.map((row) => row.text).join('')).toBe('界'.repeat(80) + 'W'.repeat(1000))
  await expect(prepare('W', 'text', 1)).rejects.toThrow('makerPayloadWidth')
  const empty = await prepare('')
  expect(empty.lineCount).toBe(0)
})
async function approval(content = 'M104 S190', serialEncoding?: 'text' | 'hex') {
  const base = {
    ...uiApproval(),
    expiresAt: Date.now() + 60_000,
    payload: content,
    digest: hash(content),
  }
  const request: ApprovalRequest =
    serialEncoding === undefined
      ? base
      : {
          id: base.id,
          digest: base.digest,
          expiresAt: base.expiresAt,
          action: base.action,
          kind: 'serial',
          target: { kind: 'serial', port: 'simulator-port' },
          payload: {
            encoding: serialEncoding,
            value: serialEncoding === 'hex' ? Buffer.from(content).toString('hex') : content,
          },
          baud: 115_200,
          durationMs: 1000,
          dtr: false,
          rts: false,
          warnsAboutReset: true,
          flashIdentity: { status: 'unknown' },
        }
  const answers: string[] = []
  const answer = (decision: string) => {
    answers.push(decision)
  }
  const reviews: string[] = []
  const review = (digest: string) => {
    reviews.push(digest)
  }
  const rendereds: string[] = []
  const rendered = (digest: string) => {
    rendereds.push(digest)
  }
  render(
    <ApprovalDialog
      request={request}
      limits={MAKER_UI_MACHINE.limits}
      onAnswer={answer}
      onReview={review}
      onRendered={rendered}
      stop={null}
    />,
  )
  await waitFor(() => {
    expect(rendereds).toContain(request.digest)
  })
  return {
    request,
    answers,
    reviews,
    send: screen.getByRole('button', { name: UI_TEXT.makerSendOnce }),
  }
}
it('a clipped initial view completes after the real outer scroll reveals the payload end', async () => {
  const { send, reviews, request } = await approval()
  expect(send).toBeDisabled()
  fireEvent.focus(screen.getByRole('region', { name: UI_TEXT.makerReadPayload }))
  expect(send).toBeDisabled()
  act(() => {
    browser.visible()
  })
  expect(send).toBeEnabled()
  expect(reviews.at(-1)).toBe(request.digest)
})
it('small payloads require the real payload container to reach its end', async () => {
  const { send } = await approval(Array.from({ length: 100 }, () => 'M104 S190').join('\n'))
  const node = screen.getByRole('region', { name: UI_TEXT.makerReadPayload })
  node.scrollTop = 0
  fireEvent.scroll(node)
  expect(send).toBeDisabled()
  act(() => {
    browser.visible()
  })
  expect(send).toBeEnabled()
})
it('a width change revokes review until the newly wrapped payload reaches its end', async () => {
  const { send } = await approval('M104 S190\n'.repeat(20))
  act(() => {
    browser.visible()
  })
  expect(send).toBeEnabled()
  act(() => {
    browser.visible.resize(120)
  })
  expect(send).toBeDisabled()
  await waitFor(() =>
    expect(document.querySelector('.maker-payload-rows')).not.toHaveStyle({ height: '0px' }),
  )
  expect(send).toBeDisabled()
})
it('large payloads require summary and digest confirmation without per-byte visibility proof', async () => {
  const { send, answers } = await approval(
    Array.from({ length: MAKER_REVIEW_SMALL_ROWS + 1 }, () => 'M104 S190').join('\n'),
  )
  act(() => {
    browser.visible()
  })
  expect(send).toBeDisabled()
  fireEvent.click(screen.getByLabelText(UI_TEXT.makerConfirmSummaryDigest))
  expect(send).toBeEnabled()
  fireEvent.click(send)
  expect(answers).toEqual(['allow_once'])
  expect(document.querySelectorAll('.maker-payload-rows > span').length).toBeLessThan(20)
})
it('dangerous temperature, bounds and disabled safety need extra acknowledgement and have jumps', async () => {
  const payload = 'M104 S250\nG1 X900 F1200\nM211 S0\nM121\nTHERMAL_RUNAWAY OFF'
  const request = {
    ...uiApproval(),
    payload,
    digest: hash(payload),
    analysis: UNSAFE_ANALYSIS,
  }
  render(
    <ApprovalDialog
      request={request}
      limits={{
        extruder: 200,
        travel: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 100 } },
      }}
      onAnswer={() => undefined}
      onRendered={() => undefined}
      stop={null}
    />,
  )
  await screen.findByLabelText(UI_TEXT.makerAcknowledgeDangers)
  expect(screen.getByText(UI_TEXT.makerDangerTemperature)).toBeInTheDocument()
  expect(screen.getByText(UI_TEXT.makerDangerTravel)).toBeInTheDocument()
  expect(screen.getByText(UI_TEXT.makerDangerSafety)).toBeInTheDocument()
  act(() => {
    browser.visible()
  })
  const send = screen.getByRole('button', { name: UI_TEXT.makerSendOnce })
  expect(send).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerNextHighlight }))
  expect(document.activeElement).toBe(
    screen.getByRole('region', { name: UI_TEXT.makerReadPayload }),
  )
  fireEvent.click(screen.getByLabelText(UI_TEXT.makerAcknowledgeDangers))
  expect(send).toBeEnabled()
})
it('summary reports chamber, bed, fan, maximum feed and a supplied time estimate', async () => {
  const summary = await summarizePayload(
    outgoingPayloadBytes(
      ';TIME:120\nM104 S180\nM104 S190\nM104 S180\nM140 S60\nM141 S40\nM106 S255\nG1 X1 F1200',
      'text',
    ),
    uiApproval(),
    { extruder: 200, bed: 70 },
    new AbortController().signal,
  )
  expect(summary).toMatchObject({
    temperatures: { extruder: 190, bed: 60, chamber: 40 },
    temperatureSettings: { extruder: [180, 190], bed: [60], chamber: [40] },
    fan: 255,
    feed: 1200,
    seconds: 120,
  })
})
it('CR-only lines and padded command codes retain every safety highlight', async () => {
  const content = 'G01 X900\rM0104 S250\rM0211 S0\r\nM104 S190 M104 S300'
  const bytes = outgoingPayloadBytes(content, 'text')
  const payload = await prepare(content)
  expect(payload.lineCount).toBe(4)
  const request = {
    ...uiApproval(),
    analysis: UNSAFE_ANALYSIS,
  }
  const summary = await summarizePayload(
    bytes,
    request,
    { extruder: 200, travel: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 100 } } },
    new AbortController().signal,
  )
  expect(summary.highlights).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ line: 1, reason: 'travel' }),
      expect.objectContaining({ line: 2, reason: 'temperature' }),
      expect.objectContaining({ line: 3, reason: 'safety' }),
      expect.objectContaining({ line: 4, reason: 'unknown' }),
    ]),
  )
  expect(payload.digest).toBe(hash(content))
})
it('firmware summary reads a known ELF entry point and its exact size', async () => {
  const bytes = new Uint8Array(32)
  bytes.set([127, 69, 76, 70, 1, 1])
  new DataView(bytes.buffer).setUint32(24, 0x8_00_01_00, true)
  const summary = await summarizePayload(bytes, undefined, undefined, new AbortController().signal)
  expect(summary.entryPoint).toBe('0x8000100')
  const payload = await canonicalPayload(bytes, 240, () => 8, new AbortController().signal)
  expect(payload.byteLength).toBe(32)
})
it('MicroPython flash review shows its frozen target and explicitly unknown file metadata', async () => {
  const payload = 'mpremote run application.py'
  const request = {
    id: MAKER_UI_ID,
    kind: 'command' as const,
    action: 'program' as const,
    target: { kind: 'workspace' as const, workspace: 'simulator-workspace' },
    payload,
    digest: hash(payload),
    expiresAt: Date.now() + 60_000,
  }
  const rendereds: string[] = []
  const rendered = (digest: string) => {
    rendereds.push(digest)
  }
  render(
    <ApprovalDialog
      request={request}
      onAnswer={() => undefined}
      onRendered={rendered}
      stop={null}
    />,
  )
  await waitFor(() => {
    expect(rendereds).toContain(request.digest)
  })
  expect(screen.getByText(UI_TEXT.makerFirmwareSizeNotice)).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toHaveTextContent(
    `${UI_TEXT.makerEntryPoint}: ${UI_TEXT.makerSummaryUnknown}`,
  )
  expect(screen.getByRole('dialog')).toHaveTextContent('simulator-workspace')
  act(() => {
    browser.visible()
  })
  const send = screen.getByRole('button', { name: UI_TEXT.makerSendOnce })
  expect(send).toBeDisabled()
  fireEvent.click(screen.getByLabelText(UI_TEXT.makerAcknowledgeDangers))
  expect(send).toBeEnabled()
})
it('replacement payload resets consent and recomputes its digest', async () => {
  const receipts: string[] = []
  const receipt = (digest: string) => {
    receipts.push(digest)
  }
  const revieweds: boolean[] = []
  const reviewed = (isComplete: boolean) => {
    revieweds.push(isComplete)
  }
  const view = render(<PayloadReview content="hello" onRendered={receipt} onReviewed={reviewed} />)
  await waitFor(() => {
    expect(receipts.at(-1)).toBe(hash('hello'))
  })
  act(() => {
    browser.visible()
  })
  expect(revieweds.at(-1)).toBe(true)
  view.rerender(<PayloadReview content={'hello\r'} onRendered={receipt} onReviewed={reviewed} />)
  await waitFor(() => {
    expect(receipts.at(-1)).toBe(hash('hello\r'))
  })
  expect(screen.getByRole('region', { name: UI_TEXT.makerReadPayload })).toHaveTextContent('hello␍')
})
it('a 100,000-line rendering stays virtual and Stop responds below 100 ms during preparation', async () => {
  const { store, posted } = uiBridge()
  store.receive(MAKER_UI_STATE)
  render(<MakerSurface store={store} />)
  const stop = screen.getByRole('button', { name: UI_TEXT.makerStopAll })
  const started = performance.now()
  const responded = new Promise<number>((resolve) =>
    setTimeout(() => {
      fireEvent.click(stop)
      resolve(performance.now() - started)
    }, 0),
  )
  act(() => {
    store.receive({
      v: 1,
      type: 'makerPreview',
      preview: {
        kind: 'payload',
        title: 'Large simulator payload',
        content: 'G1 X1\n'.repeat(100_000),
      },
    })
  })
  expect(await responded).toBeLessThan(100)
  expect(posted.at(-1)).toEqual({ v: 1, type: 'makerStop' })
  await waitFor(
    () => expect(screen.getByText(UI_TEXT.makerConfirmSummaryDigest)).toBeInTheDocument(),
    { timeout: 4000 },
  )
  expect(document.querySelectorAll('.maker-payload-rows > span').length).toBeLessThan(20)
  expect(document.querySelectorAll('.maker-payload-rows > span').length).toBeGreaterThan(0)
  store.dispose()
})
it('search reaches an unmounted row in the complete canonical rendering', async () => {
  await approval('M104 S190\n'.repeat(250) + 'needle')
  fireEvent.change(screen.getByLabelText(UI_TEXT.makerPayloadSearch), {
    target: { value: 'needle' },
  })
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerFindNext }))
  await waitFor(() =>
    expect(screen.getByRole('region', { name: UI_TEXT.makerReadPayload })).toHaveTextContent(
      'needle',
    ),
  )
})
it('Stop cancels search on its own event path before any search work resumes', async () => {
  const { store, posted } = uiBridge()
  store.receive(MAKER_UI_STATE)
  store.receive({
    v: 1,
    type: 'makerPreview',
    preview: { kind: 'payload', title: 'Search simulator', content: 'hello\n'.repeat(300) },
  })
  render(<MakerSurface store={store} />)
  await screen.findByLabelText(UI_TEXT.makerConfirmSummaryDigest)
  fireEvent.change(screen.getByLabelText(UI_TEXT.makerPayloadSearch), {
    target: { value: 'hello␊'.repeat(100) + 'Z' },
  })
  const find = screen.getByRole('button', { name: UI_TEXT.makerFindNext })
  fireEvent.click(find)
  expect(find).toHaveAttribute('aria-busy', 'true')
  expect(searchWorkers).toHaveLength(1)
  const active = searchWorkers[0]
  fireEvent.click(
    screen.getAllByRole('button', { name: UI_TEXT.makerStopAll }).at(-1) ?? document.body,
  )
  expect(posted.at(-1)).toEqual({ v: 1, type: 'makerStop' })
  expect(find).toHaveAttribute('aria-busy', 'false')
  expect(active?.terminations).toBe(1)
  store.dispose()
})
it('a changed reviewed digest irrevocably rejects a pending approval', () => {
  const { store, posted } = uiBridge()
  store.receive(MAKER_UI_STATE)
  const request = uiApproval()
  store.receive({ v: 1, type: 'makerApproval', request })
  store.previewRendered(request.id, request.digest)
  store.previewRendered(request.id, hash('different'))
  store.previewRendered(request.id, request.digest)
  expect(store.answer(request.id, 'allow_once')).toBe(false)
  expect(posted).toContainEqual(
    expect.objectContaining({
      type: 'makerAnswer',
      answer: expect.objectContaining({ decision: 'reject_once' }),
    }),
  )
  store.dispose()
})
it('read-only native preview rendering supplies no approval authority', async () => {
  const { store, posted } = uiBridge()
  store.receive(MAKER_UI_STATE)
  store.receive({
    v: 1,
    type: 'makerPreview',
    preview: { kind: 'payload', id: MAKER_UI_ID, title: 'Payload', content: 'hello' },
  })
  render(<MakerSurface store={store} />)
  await screen.findByText(UI_TEXT.makerDigestLabel, { exact: false })
  act(() => {
    browser.visible()
  })
  expect(posted).toEqual([])
  store.dispose()
})

async function expectDangerReview(content: string, encoding?: 'text' | 'hex') {
  const { send, answers, request } = await approval(content, encoding)
  if (encoding !== undefined) expect(request).not.toHaveProperty('analysis')
  const ack = screen.getByLabelText(UI_TEXT.makerAcknowledgeDangers)
  act(() => {
    browser.visible()
  })
  expect(send).toBeDisabled()
  fireEvent.click(send)
  expect(answers).toEqual([])
  fireEvent.click(ack)
  expect(send).toBeEnabled()
}

it.each(
  ['M104', 'M109', 'M140', 'M190', 'M141', 'M191'].flatMap((command) =>
    [
      'S{250}',
      'R{100}',
      'Svariable',
      'S[250]',
      'S#1',
      'S190oops',
      'S190 S250',
      'S190 R250',
      '',
    ].map((value) => `${command} ${value}`),
  ),
)('unparsed heater value %s always needs danger acknowledgement', async (content) => {
  await expectDangerReview(content)
})
it.each(['text', 'hex'] as const)(
  'serial %s shares conservative danger review without host analysis',
  async (encoding) => {
    for (const content of [
      'M104 S{250}',
      'M140 S{100}',
      'M42 P5 S255',
      'SET_GCODE_OFFSET X=900 MOVE=1',
      'SET_STEPPER_CARRIAGES STEPPER=x CARRIAGES=x DISABLE_CHECKS=1',
      'SET_HEATER_TEMPERATURE HEATER=extruder TARGET={target}',
      'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=variable',
      'G10 P0 S{250}',
      'M568 P0 S{250}',
      'CUSTOM_HEATER_MACRO TARGET=250',
      'M99999 S250',
      'M106 S{fan}',
      'STATUS HEATER=variable',
      '{heater_macro}',
    ]) {
      await expectDangerReview(content, encoding)
      cleanup()
    }
  },
)

it('worker search matches across virtual rows and respects next-match position', () => {
  expect(findPayloadMatch(['ab', 'aba', 'ba'], 'ababa', -1)).toEqual({ match: 1, jump: 0 })
  expect(findPayloadMatch(['ab', 'aba', 'ba'], 'ababa', 1)).toEqual({ match: 2, jump: 1 })
  expect(findPayloadMatch(['ab', 'aba', 'ba'], 'ababa', 2)).toEqual({ match: -1, jump: -1 })
  expect(findPayloadMatch(['😀', 'needle'], '😀needle', -1)).toEqual({ match: 1, jump: 0 })
  expect(findPayloadMatch(['abababx'], 'abababy', -1)).toEqual({ match: -1, jump: -1 })
  expect(findPayloadMatch(['ab'], '', -1)).toEqual({ match: -1, jump: -1 })
})
it('query changes terminate the worker and reject late messages and malformed results', async () => {
  await approval('M104 S190\n'.repeat(250) + 'needle')
  const input = screen.getByLabelText(UI_TEXT.makerPayloadSearch)
  fireEvent.change(input, { target: { value: 'needle' } })
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerFindNext }))
  const stale = searchWorkers[0]
  fireEvent.change(input, { target: { value: 'absent' } })
  expect(stale?.terminations).toBe(1)
  act(() => {
    stale?.deliver({ match: 250, jump: 250 })
  })
  expect(screen.getByRole('region', { name: UI_TEXT.makerReadPayload })).not.toHaveTextContent(
    'needle',
  )
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerFindNext }))
  act(() => {
    searchWorkers[1]?.deliver({ match: '250', jump: 250 })
  })
  expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.makerLoadFailed)
  expect(searchWorkers[1]?.terminations).toBe(1)
})

it('long query display stays bounded while the worker searches the entire original query', async () => {
  await approval('a'.repeat(600) + 'Y\n' + 'a'.repeat(600) + 'Z')
  const input = screen.getByLabelText(UI_TEXT.makerPayloadSearch)
  fireEvent.change(input, { target: { value: 'a'.repeat(600) + 'Z' } })
  expect(input).toHaveValue('a'.repeat(512))
  expect(input).toHaveAttribute('readonly')
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerFindNext }))
  await waitFor(() => {
    expect(
      screen.getByRole('region', { name: UI_TEXT.makerReadPayload }).scrollTop,
    ).toBeGreaterThan(0)
  })
  expect(screen.getByRole('region', { name: UI_TEXT.makerReadPayload }).scrollTop).toBeGreaterThan(
    0,
  )
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerClearSearch }))
  expect(input).toHaveValue('')
  expect(input).not.toHaveAttribute('readonly')
})

import './companion.css'
import { companionPost, companionEvents } from '../companionChannel'
import { installEmbeddedTable } from '../installTable'
import {
  companionVoiceInputSchema,
  companionVoiceOutputSchema,
  type CompanionVoiceOutput,
} from '../../shared/companionVoice'
import { companionPcm, companionWav } from '../../shared/companionWav'
import {
  MUSE_VOICE_SAMPLE_RATE,
  MILLISECONDS_PER_SECOND,
  MAX_TEXT_ATTACHMENT_BYTES,
} from '../../shared/constants'
import {
  COMPANION_VOICE_MAX_BYTES,
  COMPANION_VOICE_MAX_SECONDS,
  COMPANION_VOICE_RECORDER_BPS,
} from '../../shared/companionVoice'
import { UI_TEXT, fill, formatUnit } from '../../shared/l10n/text'

function element<T extends HTMLElement>(selector: string, kind: new () => T): T {
  const node = document.querySelector(selector)
  if (!(node instanceof kind)) throw new Error('EVOICE_PAGE')
  return node
}

function boot(): void {
  if (installEmbeddedTable(document) !== undefined) throw new Error('EVOICE_L10N')
  const start = element('#dictate', HTMLButtonElement)
  const stop = element('#stop', HTMLButtonElement)
  const cancel = element('#cancel', HTMLButtonElement)
  const send = element('#send', HTMLButtonElement)
  const prompt = element('#prompt', HTMLTextAreaElement)
  const engine = element('#engine', HTMLSelectElement)
  const status = element('#status', HTMLParagraphElement)
  const dialog = element('#consent', HTMLDialogElement)
  const title = element('#consent-title', HTMLHeadingElement)
  const detail = element('#consent-detail', HTMLParagraphElement)
  const once = element('#once', HTMLButtonElement)
  const always = element('#always', HTMLButtonElement)
  const deny = element('#deny', HTMLButtonElement)
  const ending = new AbortController()
  let generation = 0
  let approval: string | undefined
  let media: MediaStream | undefined
  let audio: AudioContext | undefined
  let recorder: MediaRecorder | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let chunks: Blob[] = []
  let recordedBytes = 0
  let ticket: string | undefined
  let captureId: string | undefined
  const cleanup = () => {
    clearTimeout(timer)
    if (recorder?.state === 'recording') recorder.stop()
    recorder = undefined
    const tracks = media?.getTracks() ?? []
    for (const track of tracks) track.stop()
    media = undefined
    if (audio !== undefined)
      void audio.close().catch(() => {
        /* Page teardown already stopped the tracks. */
      })
    audio = undefined
    stop.disabled = true
  }
  const idle = () => {
    start.disabled = engine.options.length === 0
    engine.disabled = false
    cancel.disabled = true
    prompt.disabled = false
  }
  // A stale generation's late failure must never disturb the capture that
  // replaced it: asynchronous failure callbacks pass the generation they
  // belong to, and only that generation fails. Direct user actions (cancel,
  // a dead event channel) pass none and always fail.
  const fail = (owner?: number) => {
    if (owner !== undefined && owner !== generation) return
    generation += 1
    captureId = undefined
    ticket = undefined
    cleanup()
    chunks = []
    dialog.close()
    approval = undefined
    status.textContent = UI_TEXT.companionVoiceFailed
    send.disabled = prompt.value.trim() === ''
    idle()
  }
  // Fail this generation and tell the host to drop its ticket. The cancel
  // post's own failure must not fail a newer capture either: the page
  // already reset, and a dead channel is reported through events().
  const cancelCapture = (owner: number) => {
    if (owner !== generation) return
    fail()
    const failed = generation
    void post({ type: 'cancel' }).catch(() => {
      fail(failed)
    })
  }
  const post = async (input: unknown) => {
    await companionPost(companionVoiceInputSchema.parse(input), ending.signal)
  }
  const finish = () => {
    if (recorder?.state !== 'recording') return
    recorder.stop()
    stop.disabled = true
    status.textContent = UI_TEXT.loadingOutput
  }
  const encode = async (owner: number, id: string, captured: Blob[]) => {
    cleanup()
    const decoder = new AudioContext({ sampleRate: MUSE_VOICE_SAMPLE_RATE })
    audio = decoder
    try {
      const decoded = await decoder.decodeAudioData(await new Blob(captured).arrayBuffer())
      if (owner !== generation) return
      ending.signal.throwIfAborted()
      if (decoded.sampleRate !== MUSE_VOICE_SAMPLE_RATE) throw new Error('EVOICE_RATE')
      const length = Math.min(decoded.length, COMPANION_VOICE_MAX_SECONDS * MUSE_VOICE_SAMPLE_RATE)
      if (length === 0) throw new Error('EVOICE_SIZE')
      const channels: [Float32Array, ...Float32Array[]] = [decoded.getChannelData(0)]
      for (let channel = 1; channel < decoded.numberOfChannels; channel++)
        channels.push(decoded.getChannelData(channel))
      const pcm = companionPcm(channels, length)
      for (const floats of channels) floats.fill(0)
      const wav = companionWav(pcm)
      pcm.fill(0)
      let encoded = ''
      for (const byte of wav) encoded += String.fromCodePoint(byte)
      wav.fill(0)
      await post({ type: 'audio', ticket: id, wav: btoa(encoded) })
    } finally {
      if (decoder.state !== 'closed') await decoder.close()
      if (audio === decoder) audio = undefined
    }
  }
  const record = async (ready: Extract<CompanionVoiceOutput, { type: 'ready' }>) => {
    const owner = generation
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
      video: false,
    })
    if (owner !== generation || ending.signal.aborted) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    media = stream
    ticket = ready.ticket
    recordedBytes = 0
    chunks = []
    recorder = new MediaRecorder(stream, { audioBitsPerSecond: COMPANION_VOICE_RECORDER_BPS })
    recorder.addEventListener('dataavailable', (event) => {
      if (owner !== generation) return
      recordedBytes += event.data.size
      if (recordedBytes > COMPANION_VOICE_MAX_BYTES) {
        cancelCapture(owner)
        return
      }
      chunks.push(event.data)
    })
    recorder.addEventListener('stop', () => {
      // A replaced capture's late stop event owns nothing: its tracks were
      // stopped when it failed, and the chunks now belong to the new one.
      if (owner !== generation) return
      const id = ticket
      const captured = chunks
      chunks = []
      if (id === undefined) {
        cleanup()
        return
      }
      void encode(owner, id, captured).catch(() => {
        cancelCapture(owner)
      })
    })
    recorder.addEventListener('error', () => {
      cancelCapture(owner)
    })
    recorder.start(MILLISECONDS_PER_SECOND)
    timer = setTimeout(finish, COMPANION_VOICE_MAX_SECONDS * MILLISECONDS_PER_SECOND)
    stop.disabled = false
    status.textContent = UI_TEXT.dictationListening
    stop.focus()
  }
  const event = async (message: CompanionVoiceOutput) => {
    switch (message.type) {
      case 'ready': {
        if (message.id === captureId) {
          const owner = generation
          void record(message).catch(() => {
            cancelCapture(owner)
          })
        }

        break
      }
      case 'consent': {
        if (message.capture !== captureId) {
          await post({ type: 'answer', id: message.id, answer: 'deny' })
          return
        }
        approval = message.id
        title.textContent = message.title
        detail.textContent = message.detail
        always.hidden = !message.canRemember
        dialog.showModal()
        deny.focus()

        break
      }
      case 'transcript': {
        if (message.ticket !== ticket) return
        ticket = undefined
        prompt.setRangeText(message.text, prompt.selectionStart, prompt.selectionEnd, 'end')
        send.disabled = false
        status.textContent = message.paid
          ? fill(UI_TEXT.companionVoicePaidSummary, {
              duration: formatUnit(message.seconds, 'second'),
            })
          : UI_TEXT.companionVoiceReview
        idle()
        prompt.focus()

        break
      }
      case 'error': {
        fail()
        break
      }
      default: {
        prompt.value = ''
        send.disabled = true
        status.textContent = UI_TEXT.companionVoiceReview
        idle()
      }
    }
  }
  const ready = Promise.withResolvers<undefined>()
  const events = async () => {
    await companionEvents({
      signal: ending.signal,
      maxBytes: MAX_TEXT_ATTACHMENT_BYTES,
      ready: () => {
        ready.resolve(undefined)
      },
      event: async (raw) => {
        await event(companionVoiceOutputSchema.parse(raw))
      },
    })
  }
  start.addEventListener('click', () => {
    generation += 1
    const owner = generation
    start.disabled = true
    send.disabled = true
    engine.disabled = true
    cancel.disabled = false
    captureId = crypto.randomUUID()
    const id = captureId
    status.textContent = UI_TEXT.dictationStarting
    void ready.promise
      .then(() => post({ type: 'begin', id, engine: engine.value }))
      .catch(() => {
        fail(owner)
      })
  })
  stop.addEventListener('click', finish)
  cancel.addEventListener('click', () => {
    fail()
    status.textContent = UI_TEXT.companionVoiceReview
    void post({ type: 'cancel' }).catch(fail)
  })
  send.addEventListener('click', () => {
    if (new TextEncoder().encode(prompt.value).length > MAX_TEXT_ATTACHMENT_BYTES) {
      fail()
      return
    }
    const owner = generation
    send.disabled = true
    prompt.disabled = true
    start.disabled = true
    engine.disabled = true
    void post({ type: 'send', text: prompt.value }).catch(() => {
      send.disabled = false
      fail(owner)
    })
  })
  prompt.addEventListener('input', () => {
    // A corrected reviewed prompt re-enables Send on its own. A capture in
    // flight still owns Send until its transcript arrives, and a dead event
    // channel leaves the start control disabled, so neither admits a send.
    if (start.disabled) return
    send.disabled = prompt.value.trim() === ''
  })
  const answer = (value: 'once' | 'always' | 'deny') => {
    const id = approval
    const owner = generation
    approval = undefined
    dialog.close()
    if (id !== undefined)
      void post({ type: 'answer', id, answer: value }).catch(() => {
        fail(owner)
      })
  }
  once.addEventListener('click', () => {
    answer('once')
  })
  always.addEventListener('click', () => {
    answer('always')
  })
  deny.addEventListener('click', () => {
    answer('deny')
  })
  dialog.addEventListener('cancel', () => {
    answer('deny')
  })
  window.addEventListener(
    'pagehide',
    () => {
      generation += 1
      ending.abort()
      cleanup()
      chunks = []
    },
    { once: true },
  )
  void events().catch(() => {
    ready.reject(new Error('EVOICE_CLOSED'))
    fail()
    status.textContent = UI_TEXT.companionLaunchFailed
    start.disabled = true
  })
  void ready.promise.catch(() => {
    /* The start action displays the failure. */
  })
  idle()
}

function startPage(): void {
  try {
    boot()
  } catch {
    const status = document.querySelector('#status')
    if (status !== null) status.textContent = UI_TEXT.companionVoiceFailed
  }
}
startPage()

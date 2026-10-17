import { mkdtemp, open, rm } from 'node:fs/promises'
import path from 'node:path'
import { companionWavSeconds } from '../../shared/companionWav'
import {
  LineSplitter,
  parseHelperLine,
  type HelperChild,
  type HelperInvocation,
} from '../../core/voice/dictation'
import {
  DICTATION_QUIT_GRACE_MS,
  MEMORY_STAGE_FILE_MODE,
  MAX_TEXT_ATTACHMENT_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { COMPANION_VOICE_REQUEST_MS } from '../../shared/companionVoice'
import { withDeadline } from '../../core/timeouts'
import { secure } from '../tokenFile'

/** File recognition uses the same OS engine; no host microphone is opened. */
export async function transcribeCompanionSystem(
  wav: Uint8Array,
  signal: AbortSignal,
  deps: {
    readonly platform: NodeJS.Platform
    readonly temporaryRoot: string
    readonly invocation: HelperInvocation
    readonly spawn: (invocation: HelperInvocation) => HelperChild
  },
): Promise<string> {
  signal.throwIfAborted()
  companionWavSeconds(wav)
  if (deps.platform !== 'win32' && deps.platform !== 'darwin')
    throw new Error(UI_TEXT.dictationUnavailableLinux)
  const directory = await mkdtemp(path.join(deps.temporaryRoot, 'muse-dictation-'))
  const file = path.join(directory, 'dictation.wav')
  let child: HelperChild | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  let exit: Promise<void> | undefined
  try {
    await secure(directory, true)
    const handle = await open(file, 'wx', MEMORY_STAGE_FILE_MODE)
    try {
      await secure(file, false)
      await handle.writeFile(wav)
    } finally {
      await handle.close()
    }
    signal.throwIfAborted()
    child = deps.spawn({
      ...deps.invocation,
      args: [
        ...deps.invocation.args,
        deps.platform === 'win32' ? '-InputWav' : '--input-wav',
        file,
      ],
    })
    const helper = child
    let confirmExit!: () => void
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- The native helper also ships to Node 20 hosts; resolver assignment is synchronous (PLAN.md §8).
    exit = new Promise<void>((resolve) => {
      confirmExit = resolve
    })
    return await new Promise<string>((resolve, reject) => {
      let isFailed = false
      const fail = () => {
        if (isFailed) return
        isFailed = true
        reject(new Error(UI_TEXT.companionVoiceFailed))
        helper.kill()
      }
      abort = fail
      helper.onExit(() => {
        confirmExit()
        fail()
      })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) {
        fail()
        return
      }
      timer = setTimeout(fail, COMPANION_VOICE_REQUEST_MS)
      const lines = new LineSplitter()
      let text = ''
      let receivedBytes = 0
      helper.stdout.on('data', (chunk) => {
        receivedBytes += Buffer.byteLength(chunk)
        if (receivedBytes > MAX_TEXT_ATTACHMENT_BYTES) {
          fail()
          return
        }
        for (const line of lines.push(chunk)) {
          const message = parseHelperLine(line)
          if (message === undefined || message.type === 'error') {
            fail()
            return
          }
          if (message.type === 'ready') helper.send('start')
          else if (message.type === 'text') {
            text += `${text === '' ? '' : ' '}${message.text}`
            if (Buffer.byteLength(text) > MAX_TEXT_ATTACHMENT_BYTES) {
              fail()
              return
            }
          }
          if (message.type !== 'stopped') {
            continue
          }

          if (text.trim() === '') {
            fail()
            return
          }
          resolve(text)
          return
        }
      })
    })
  } finally {
    clearTimeout(timer)
    if (abort !== undefined) signal.removeEventListener('abort', abort)
    child?.kill()
    try {
      if (exit !== undefined)
        await withDeadline(exit, DICTATION_QUIT_GRACE_MS, UI_TEXT.companionVoiceFailed)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}

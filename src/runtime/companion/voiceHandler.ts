import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import {
  companionVoiceInputSchema,
  companionVoiceOutputSchema,
  type CompanionVoiceInput,
  type CompanionVoiceOutput,
  type CompanionVoiceEngine,
} from '../../shared/companionVoice'
import { MAX_TEXT_ATTACHMENT_BYTES, UI_TEXT } from '../../shared/constants'
import { COMPANION_VOICE_TICKET_MS } from '../../shared/companionVoice'
import { companionWavSeconds } from '../../shared/companionWav'
import type { PaidUseAnswer } from '../../core/paid/paidConsent'
import type { CompanionHandler } from './server'

export interface CompanionVoiceWindow {
  prepare(
    ask: (title: string, detail: string, canRemember: boolean) => Promise<PaidUseAnswer>,
    signal: AbortSignal,
  ): Promise<void>
  transcribe(wav: Uint8Array, signal: AbortSignal): Promise<{ text: string; seconds: number }>
}
export interface CompanionVoiceDeps {
  readonly createPaidWindow: () => CompanionVoiceWindow
  readonly transcribeSystem: (wav: Uint8Array, signal: AbortSignal) => Promise<string>
  /** Inserts only into the owning prompt after the user presses Send. */
  readonly askPaid?: (
    title: string,
    detail: string,
    canRemember: boolean,
    signal: AbortSignal,
  ) => Promise<PaidUseAnswer>
  readonly send: (text: string, signal: AbortSignal) => Promise<void>
  readonly isCurrent: () => boolean
}
interface VoiceWindow {
  readonly emit: (message: CompanionVoiceOutput) => void
  readonly ending: AbortController
  readonly paid: CompanionVoiceWindow
  operation?: AbortController
  ticket?: { id: string; engine: CompanionVoiceEngine; expiresAt: number }
  approval?: { id: string; canRemember: boolean; resolve(answer: PaidUseAnswer): void }
  canSend: boolean
}

/** Per-authenticated-page ownership. Disconnect cancels capture/consent/HTTP/helper. */
export function companionVoiceHandler(
  deps: CompanionVoiceDeps,
): CompanionHandler<CompanionVoiceInput, CompanionVoiceOutput> {
  const windows = new Map<string, VoiceWindow>()
  const cancel = (state: VoiceWindow) => {
    state.operation?.abort()
    state.approval?.resolve('deny')
    delete state.approval
    delete state.ticket
  }
  return {
    inputSchema: companionVoiceInputSchema,
    outputSchema: companionVoiceOutputSchema,
    subscribe(session, emit) {
      const state: VoiceWindow = {
        emit,
        ending: new AbortController(),
        paid: deps.createPaidWindow(),
        canSend: false,
      }
      windows.set(session, state)
      return () => {
        state.ending.abort()
        cancel(state)
        windows.delete(session)
      }
    },
    async post(input, session, signal) {
      const state = windows.get(session)
      if (state === undefined || !deps.isCurrent()) throw new Error('EVOICE_OWNER')
      if (input.type === 'cancel') {
        cancel(state)
        return
      }
      if (input.type === 'answer') {
        const approval = state.approval
        if (approval?.id !== input.id || (input.answer === 'always' && !approval.canRemember))
          throw new Error('EVOICE_CONSENT')
        delete state.approval
        approval.resolve(input.answer)
        return
      }
      if (state.operation !== undefined) throw new Error('EVOICE_BUSY')
      const operation = new AbortController()
      state.operation = operation
      const active = AbortSignal.any([signal, operation.signal, state.ending.signal])
      let bytes: Buffer | undefined
      const check = () => {
        active.throwIfAborted()
        if (!deps.isCurrent()) throw new Error('EVOICE_OWNER')
      }
      try {
        check()
        if (input.type === 'begin') {
          if (state.ticket !== undefined) throw new Error('EVOICE_BUSY')
          if (input.engine === 'museVoice') {
            await state.paid.prepare(
              (title, detail, canRemember) =>
                deps.askPaid === undefined
                  ? new Promise<PaidUseAnswer>((resolve) => {
                      const id = randomUUID()
                      state.approval = { id, canRemember, resolve }
                      state.emit({
                        type: 'consent',
                        id,
                        capture: input.id,
                        title,
                        detail,
                        canRemember,
                      })
                    })
                  : deps.askPaid(title, detail, canRemember, active),
              active,
            )
            check()
          }
          const id = randomUUID()
          state.ticket = {
            id,
            engine: input.engine,
            expiresAt: Date.now() + COMPANION_VOICE_TICKET_MS,
          }
          state.emit({
            type: 'ready',
            id: input.id,
            ticket: id,
            paid: input.engine === 'museVoice',
          })
        } else if (input.type === 'audio') {
          const ticket = state.ticket
          delete state.ticket
          if (ticket?.id !== input.ticket || Date.now() >= ticket.expiresAt)
            throw new Error('EVOICE_TICKET')
          bytes = Buffer.from(input.wav, 'base64')
          if (bytes.toString('base64') !== input.wav) throw new Error('EVOICE_WAV')
          const seconds = companionWavSeconds(bytes)
          const result =
            ticket.engine === 'system'
              ? { text: await deps.transcribeSystem(bytes, active), seconds }
              : await state.paid.transcribe(bytes, active)
          check()
          if (
            result.text.trim() === '' ||
            Buffer.byteLength(result.text) > MAX_TEXT_ATTACHMENT_BYTES
          )
            throw new Error('EVOICE_TEXT')
          state.canSend = true
          state.emit({
            type: 'transcript',
            ticket: input.ticket,
            text: result.text,
            paid: ticket.engine === 'museVoice',
            seconds: result.seconds,
          })
        } else {
          if (
            state.ticket !== undefined ||
            !state.canSend ||
            input.text.trim() === '' ||
            Buffer.byteLength(input.text) > MAX_TEXT_ATTACHMENT_BYTES
          )
            throw new Error('EVOICE_TEXT')
          state.canSend = false
          try {
            await deps.send(input.text, active)
          } catch (error: unknown) {
            state.canSend = true
            throw error
          }
          state.emit({ type: 'sent' })
        }
      } catch {
        if (!active.aborted) state.emit({ type: 'error', text: UI_TEXT.companionVoiceFailed })
      } finally {
        bytes?.fill(0)
        state.approval?.resolve('deny')
        delete state.approval
        if (state.operation === operation) delete state.operation
      }
    },
  }
}

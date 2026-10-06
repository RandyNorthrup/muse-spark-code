import { useRef, useState } from 'react'
import type { ChatShareRequest } from '../../core/sharing/chatShare'
import { parseChatSharePreview, type ChatSharePreview } from '../../core/sharing/shareRelease'
import { UI_TEXT } from '../../shared/constants'
import { shareRequestSchema } from '../../shared/share'
import { Modal } from '../components/Modal'
import './sharing.css'

/** Native hosts and the companion page bind the same validated bridge port. */
export interface ChatShareDialogPort {
  readonly preview: (request: ChatShareRequest) => Promise<unknown>
  readonly confirm: (release: {
    step: 'confirmed'
    previewId: string
    request: ChatShareRequest
  }) => Promise<'shared' | 'dismissed'>
  readonly invalidate: () => void
  /** Persist only these preferences in the current workspace, never share text. */
  readonly remember: (mode: ChatShareRequest['mode'], format: ChatShareRequest['format']) => void
}

export interface ChatShareDialogProps {
  readonly sessionId: string
  readonly messages: readonly { readonly id: string; readonly label: string }[]
  readonly attachments: readonly { readonly id: string; readonly name: string }[]
  readonly initialMode: ChatShareRequest['mode']
  readonly initialFormat: ChatShareRequest['format']
  readonly port: ChatShareDialogPort
  readonly onClose: () => void
}

const REDACTION = /(\[(?:redacted(?: path| account)?|home|user|path)\])/g

/** The exact bytes, as text only; highlights add no characters to the preview. */
function PreviewBytes({ content }: { readonly content: string }) {
  return (
    <pre className="chat-share-preview" tabIndex={0}>
      {content
        .split(REDACTION)
        .map((part, index) =>
          /^\[(?:redacted(?: path| account)?|home|user|path)\]$/.test(part) ? (
            <mark key={index}>{part}</mark>
          ) : (
            part
          ),
        )}
    </pre>
  )
}

function failureText(error: unknown): string {
  const known = [
    UI_TEXT.shareConfidential,
    UI_TEXT.shareRangeInvalid,
    UI_TEXT.shareTooLarge,
    UI_TEXT.shareAttachmentUnavailable,
    UI_TEXT.sharePreviewExpired,
    UI_TEXT.exportNothing,
    UI_TEXT.exportHistoryUnavailable,
  ]
  return error instanceof Error && known.includes(error.message)
    ? error.message
    : UI_TEXT.exportFailed
}

/** Loaded on first Share action by the integration host; no destination side effects on mount. */
export function ChatShareDialog({
  sessionId,
  messages,
  attachments,
  initialMode,
  initialFormat,
  port,
  onClose,
}: ChatShareDialogProps) {
  const [request, setRequest] = useState<ChatShareRequest>({
    target: 'chat',
    sessionId,
    mode: initialMode,
    format: initialFormat,
    destination: 'copy',
    options: { codeBlocks: true, attachmentNames: true, diffs: false, attachmentContents: [] },
  })
  const [preview, setPreview] = useState<ChatSharePreview | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const change = (next: ChatShareRequest) => {
    generation.current += 1
    port.invalidate()
    setRequest(next)
    setPreview(undefined)
    setError(undefined)
    setBusy(false)
    if (next.mode !== request.mode || next.format !== request.format)
      port.remember(next.mode, next.format)
  }
  const close = () => {
    generation.current += 1
    port.invalidate()
    onClose()
  }
  const showPreview = async () => {
    const current = ++generation.current
    setPreview(undefined)
    setError(undefined)
    setBusy(true)
    try {
      const shown = parseChatSharePreview(await port.preview(request))
      if (current !== generation.current) return
      if (JSON.stringify(shown.request) !== JSON.stringify(shareRequestSchema.parse(request)))
        throw new Error(UI_TEXT.sharePreviewExpired)
      setPreview(shown)
      port.remember(request.mode, request.format)
    } catch (error_) {
      if (current === generation.current) setError(failureText(error_))
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  const confirm = async () => {
    if (preview === undefined || busy) return
    const current = generation.current
    setBusy(true)
    setError(undefined)
    try {
      const result = await port.confirm({
        step: 'confirmed',
        previewId: preview.previewId,
        request: preview.request,
      })
      if (result === 'shared' && current === generation.current) close()
    } catch (error_) {
      if (current === generation.current) setError(failureText(error_))
    } finally {
      if (current === generation.current) {
        setPreview(undefined)
        setBusy(false)
      }
    }
  }
  const setRange = (side: 'from' | 'to', id: string) => {
    if (id === '') {
      const { range: _range, ...whole } = request
      change(whole)
    } else {
      change({
        ...request,
        range: {
          from: messages[0]?.id ?? id,
          to: messages.at(-1)?.id ?? id,
          ...request.range,
          [side]: id,
        },
      })
    }
  }
  return (
    <Modal title={UI_TEXT.shareChat} titleId="chat-share-title" isWide onClose={close}>
      <div className="chat-share-controls">
        <fieldset disabled={busy}>
          <legend>{UI_TEXT.shareMode}</legend>
          <label>
            <input
              type="radio"
              name="chat-share-mode"
              checked={request.mode === 'conversation'}
              onChange={() => {
                change({ ...request, mode: 'conversation' })
              }}
            />
            {UI_TEXT.shareConversation}
          </label>
          <label>
            <input
              type="radio"
              name="chat-share-mode"
              checked={request.mode === 'full'}
              onChange={() => {
                change({ ...request, mode: 'full' })
              }}
            />
            {UI_TEXT.shareFull}
          </label>
        </fieldset>
        <label>
          {UI_TEXT.shareFormat}
          <select
            disabled={busy || request.destination === 'browser'}
            value={request.format}
            onChange={(event) => {
              const format = event.target.value
              switch (format) {
                case 'md':
                case 'html':
                case 'json': {
                  change({ ...request, format })
                  break
                }
              }
            }}
          >
            <option value="md">Markdown</option>
            <option value="html">HTML</option>
            <option value="json">JSON</option>
          </select>
        </label>
        {(['from', 'to'] as const).map((side) => (
          <label key={side}>
            {side === 'from' ? UI_TEXT.shareRangeFrom : UI_TEXT.shareRangeTo}
            <select
              disabled={busy}
              value={request.range?.[side] ?? ''}
              onChange={(event) => {
                setRange(side, event.target.value)
              }}
            >
              <option value="">{UI_TEXT.shareAllMessages}</option>
              {messages.map((message) => (
                <option key={message.id} value={message.id}>
                  {message.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          <input
            disabled={busy}
            type="checkbox"
            checked={request.options.codeBlocks}
            onChange={(event) => {
              change({
                ...request,
                options: { ...request.options, codeBlocks: event.target.checked },
              })
            }}
          />
          {UI_TEXT.shareCodeBlocks}
        </label>
        <label>
          <input
            disabled={busy}
            type="checkbox"
            checked={request.options.attachmentNames}
            onChange={(event) => {
              change({
                ...request,
                options: { ...request.options, attachmentNames: event.target.checked },
              })
            }}
          />
          {UI_TEXT.shareAttachmentNames}
        </label>
        <label>
          <input
            disabled={busy || request.mode === 'conversation'}
            type="checkbox"
            checked={request.options.diffs}
            onChange={(event) => {
              change({ ...request, options: { ...request.options, diffs: event.target.checked } })
            }}
          />
          {UI_TEXT.shareDiffs}
        </label>
        {attachments.length === 0 ? null : (
          <fieldset disabled={busy}>
            <legend>{UI_TEXT.shareAttachmentContents}</legend>
            {attachments.map((attachment) => (
              <label key={attachment.id}>
                <input
                  type="checkbox"
                  checked={request.options.attachmentContents.includes(attachment.id)}
                  onChange={(event) => {
                    change({
                      ...request,
                      options: {
                        ...request.options,
                        attachmentContents: event.target.checked
                          ? [...request.options.attachmentContents, attachment.id]
                          : request.options.attachmentContents.filter((id) => id !== attachment.id),
                      },
                    })
                  }}
                />
                {attachment.name}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset disabled={busy}>
          <legend>{UI_TEXT.shareConfirm}</legend>
          {(['copy', 'file', 'browser'] as const).map((destination) => (
            <label key={destination}>
              <input
                type="radio"
                name="chat-share-destination"
                checked={request.destination === destination}
                onChange={() => {
                  change({
                    ...request,
                    destination,
                    ...(destination === 'browser' && { format: 'html' }),
                  })
                }}
              />
              {
                { copy: UI_TEXT.shareCopy, file: UI_TEXT.shareFile, browser: UI_TEXT.shareBrowser }[
                  destination
                ]
              }
            </label>
          ))}
        </fieldset>
      </div>
      <p>{UI_TEXT.shareReviewPrivacy}</p>
      {error === undefined ? null : <p role="alert">{error}</p>}
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={() => {
          void showPreview()
        }}
      >
        {UI_TEXT.sharePreview}
      </button>
      {preview === undefined ? null : (
        <section aria-label={UI_TEXT.sharePreview}>
          <p>{preview.fileName}</p>
          <PreviewBytes content={preview.content} />
        </section>
      )}
      <button
        type="button"
        className="button-primary"
        disabled={busy || preview === undefined}
        onClick={() => {
          void confirm()
        }}
      >
        {UI_TEXT.shareConfirm}
      </button>
    </Modal>
  )
}

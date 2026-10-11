import { useEffect, useState } from 'react'
import * as z from 'zod/mini'
import { ChatShareDialog, type ChatShareDialogPort } from './ChatShareDialog'
import { sharingRpc } from './sharingRpc'
import type { WebviewToHostMessage } from '../../shared/protocol'
import { UI_TEXT } from '../../shared/constants'
import { Modal } from '../components/Modal'

const contextSchema = z.strictObject({
  sessionId: z.string(),
  messages: z.array(z.strictObject({ id: z.string(), label: z.string() })),
  attachments: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  initialMode: z.enum(['full', 'conversation']),
  initialFormat: z.enum(['md', 'html', 'json']),
})

export function ChatShareBridge({
  post,
  onClose,
}: {
  readonly post: (message: WebviewToHostMessage) => void
  readonly onClose: () => void
}) {
  const [rpc] = useState(() => sharingRpc(post))
  const [context, setContext] = useState<z.infer<typeof contextSchema>>()
  const [error, setError] = useState<string>()
  const [port] = useState<ChatShareDialogPort>(() => ({
    preview: (request) => rpc.ask('chatPreview', request),
    confirm: async (release) =>
      z.enum(['shared', 'dismissed']).parse(await rpc.ask('chatConfirm', release)),
    invalidate: () => {
      void rpc.ask('invalidate').catch(() => {
        /* Closing already invalidates the host token. */
      })
    },
    remember: (mode, format) => {
      void rpc.ask('remember', { mode, format }).catch(() => {
        /* Preference failure grants no release. */
      })
    },
  }))
  useEffect(() => {
    rpc.open()
    void rpc
      .ask('chatContext')
      .then((value) => {
        setContext(contextSchema.parse(value))
      })
      .catch((error_: unknown) => {
        setError(error_ instanceof Error ? error_.message : UI_TEXT.exportFailed)
      })
    return () => {
      rpc.close()
    }
  }, [rpc])
  if (context === undefined)
    return (
      <Modal title={UI_TEXT.shareChat} titleId="chat-share-loading" onClose={onClose}>
        <p role="status">{error ?? UI_TEXT.loadingOutput}</p>
      </Modal>
    )
  return <ChatShareDialog {...context} port={port} onClose={onClose} />
}

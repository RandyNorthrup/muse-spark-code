import { useCallback, useEffect, useState } from 'react'
import * as z from 'zod/mini'
import { savedPromptSchema } from '../../shared/prompts'
import { UI_TEXT } from '../../shared/constants'
import type { WebviewToHostMessage } from '../../shared/protocol'
import type { PromptImportPreview } from '../../core/prompts/promptTypes'
import { PromptLibrary, type PromptLibraryPort } from './PromptLibrary'
import { sharingRpc } from '../sharing/sharingRpc'

const rowsSchema = z.strictObject({
  prompts: z.array(savedPromptSchema),
  hasWorkspace: z.boolean(),
  canImportLinks: z.boolean(),
  error: z.optional(z.string()),
})
const importSchema = z.strictObject({
  id: z.string(),
  prompt: savedPromptSchema,
  variables: z.array(
    z.strictObject({
      name: z.string(),
      source: z.enum(['selection', 'file', 'clipboard', 'input']),
    }),
  ),
})
const previewSchema = z.strictObject({ id: z.string(), text: z.string() })

/** The same dialog and validated host actions work over every editor's bridge. */
export function PromptLibraryBridge({
  post,
  onClose,
}: {
  readonly post: (message: WebviewToHostMessage) => void
  readonly onClose: () => void
}) {
  const [rpc] = useState(() => sharingRpc(post))
  const [rows, setRows] = useState<z.infer<typeof rowsSchema>>()
  const [error, setError] = useState<string>()
  const [importPreview, setImportPreview] = useState<PromptImportPreview>()
  const [sharePreview, setSharePreview] = useState<z.infer<typeof previewSchema>>()
  const refresh = useCallback(async () => {
    setRows(rowsSchema.parse(await rpc.ask('list')))
  }, [rpc])
  const run = (action: string, payload: unknown) => {
    void rpc
      .ask(action, payload)
      .then(refresh)
      .catch(() => {
        setError(UI_TEXT.promptFileInvalid)
      })
  }
  useEffect(() => {
    rpc.open()
    void rpc
      .ask('list')
      .then((value) => {
        setRows(rowsSchema.parse(value))
      })
      .catch(() => {
        setError(UI_TEXT.promptStoreDamaged)
      })
    return () => {
      rpc.close()
    }
  }, [rpc, refresh])
  const port: PromptLibraryPort = {
    save: async (draft, previous) => {
      const saved = savedPromptSchema.parse(await rpc.ask('saveDraft', { draft, previous }))
      await refresh()
      return saved
    },
    remove: (prompt) => {
      run('remove', prompt)
    },
    duplicate: (prompt, scope) => {
      run('duplicate', { prompt, scope })
    },
    insert: (prompt) => {
      run('insert', prompt)
    },
    run: (prompt) => {
      run('insert', prompt)
    },
    share: (prompt) => {
      void rpc
        .ask('sharePromptPreview', prompt)
        .then((value) => {
          if (value !== undefined) setSharePreview(previewSchema.parse(value))
        })
        .catch(() => {
          setError(UI_TEXT.shareConfidential)
        })
    },
    importPrompt: (kind) => {
      void rpc
        .ask('importPreview', { kind })
        .then((value) => {
          if (value !== undefined) setImportPreview(importSchema.parse(value))
        })
        .catch(() => {
          setError(UI_TEXT.promptFileInvalid)
        })
    },
    acceptImport: (previewId) => {
      run('acceptImport', { previewId })
      setImportPreview(undefined)
    },
    confirmShare: (previewId) => {
      run('confirmPromptShare', { previewId })
      setSharePreview(undefined)
    },
  }
  const shownError = error ?? rows?.error
  return (
    <PromptLibrary
      prompts={rows?.prompts ?? []}
      hasWorkspace={rows?.hasWorkspace ?? false}
      canImportLinks={rows?.canImportLinks ?? false}
      port={port}
      {...(importPreview !== undefined && { importPreview })}
      {...(sharePreview !== undefined && { sharePreview })}
      {...(shownError !== undefined && { error: shownError })}
      onClose={onClose}
    />
  )
}

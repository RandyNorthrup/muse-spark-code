import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PromptLibrary } from '../../../src/webview/prompts/PromptLibrary'
import type { SavedPrompt } from '../../../src/shared/prompts'
import { savedPromptFixture } from './sharingFixtures'
import { EN, type UiText } from '../../../src/shared/l10n/en'
import { setUiText } from '../../../src/shared/l10n/text'
import '../../../src/webview/styles.css'

/** The scripted fake host used for M118 P screenshots; never shipped. */
function PromptHarness({ scenario }: { readonly scenario: string }) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([
    savedPromptFixture,
    { ...savedPromptFixture, scope: 'workspace', untrusted: true },
  ])
  const [isClosed, setClosed] = useState(false)
  const [share, setShare] = useState<{ id: string; text: string } | undefined>(
    scenario === 'share'
      ? { id: 'share-preview', text: 'Review [redacted] in [home]; [user], [path], [workspace].' }
      : undefined,
  )
  if (isClosed) return null
  return (
    <PromptLibrary
      prompts={prompts}
      hasWorkspace
      canImportLinks
      {...(scenario === 'damaged'
        ? { error: 'The prompt store is unreadable or damaged. Its files were kept unchanged.' }
        : {})}
      {...(scenario === 'import'
        ? {
            importPreview: {
              id: 'import-preview',
              prompt: { ...savedPromptFixture, untrusted: true },
              variables: savedPromptFixture.variables,
            },
          }
        : {})}
      {...(share === undefined ? {} : { sharePreview: share })}
      port={{
        save: (draft, previous) => {
          setPrompts((rows) => [
            ...rows.filter((row) => row.id !== previous?.id || row.scope !== previous.scope),
            {
              ...savedPromptFixture,
              ...draft,
              tags: [...draft.tags],
              id: previous?.id ?? 'new',
              untrusted: previous?.untrusted ?? false,
            },
          ])
        },
        remove: (prompt) => {
          setPrompts((rows) => rows.filter((row) => row !== prompt))
        },
        duplicate: (prompt, scope) => {
          setPrompts((rows) => [...rows, { ...prompt, scope, id: `copy-${String(rows.length)}` }])
        },
        insert: () => {
          setClosed(true)
        },
        run: () => {
          setClosed(true)
        },
        share: (prompt) => {
          setShare({ id: 'share-preview', text: prompt.body })
        },
        importPrompt: () => {
          setPrompts((rows) => [
            ...rows,
            { ...savedPromptFixture, id: 'imported', untrusted: true },
          ])
        },
        acceptImport: () => {
          setClosed(true)
        },
        confirmShare: () => {
          setShare(undefined)
        },
      }}
      onClose={() => {
        setClosed(true)
      }}
    />
  )
}

export function mountPromptHarness(
  element: Element,
  scenario: string,
  table: UiText = EN,
  locale = 'en',
): () => void {
  setUiText(table, locale)
  const root = createRoot(element)
  root.render(<PromptHarness scenario={scenario} />)
  return () => {
    root.unmount()
  }
}

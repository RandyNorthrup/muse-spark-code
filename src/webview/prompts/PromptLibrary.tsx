import './PromptLibrary.css'
import { useEffect, useRef, useState } from 'react'
import { PROMPT_LIMITS, UI_TEXT } from '../../shared/constants'
import type { SavedPrompt } from '../../shared/prompts'
import type { PromptDraft, PromptImportPreview } from '../../core/prompts/promptTypes'
import { filterPrompts } from '../../core/prompts/promptSearch'
import { Modal } from '../components/Modal'

/** M118-P-REACT-BRIDGE: W/native hosts bind these actions to validated messages. */
export interface PromptLibraryPort {
  save(draft: PromptDraft, previous?: SavedPrompt): Promise<SavedPrompt>
  remove(prompt: SavedPrompt): void
  duplicate(prompt: SavedPrompt, scope: SavedPrompt['scope']): void
  insert(prompt: SavedPrompt): void
  run(prompt: SavedPrompt): void
  share(prompt: SavedPrompt): void
  importPrompt(kind: 'file' | 'link'): void
  acceptImport(previewId: string): void
  confirmShare(previewId: string): void
}

export interface PromptLibraryProps {
  readonly prompts: readonly SavedPrompt[]
  readonly port: PromptLibraryPort
  readonly hasWorkspace: boolean
  readonly canImportLinks: boolean
  readonly importPreview?: PromptImportPreview
  readonly sharePreview?: { readonly id: string; readonly text: string }
  readonly error?: string
  readonly onClose: () => void
}
interface Edit {
  readonly previous?: SavedPrompt
  readonly title: string
  readonly body: string
  readonly tags: string
  readonly scope: SavedPrompt['scope']
}

function SharePreviewText({ text }: { readonly text: string }) {
  return text
    .split(/(\[(?:redacted|home|user|path|workspace)\])/g)
    .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))
}

/** Shared React library; the host owns all IO, variable review and confirmation. */
export function PromptLibrary(props: PromptLibraryProps) {
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [edit, setEdit] = useState<Edit>()
  const [isSaving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [deleting, setDeleting] = useState<SavedPrompt>()
  const rows = filterPrompts(props.prompts, query, tag === '' ? undefined : tag)
  const tags = [...new Set(props.prompts.flatMap((prompt) => prompt.tags))].toSorted(
    (left, right) => left.localeCompare(right),
  )
  useEffect(() => {
    search.current?.focus()
  }, [])
  const startEdit = (prompt?: SavedPrompt) => {
    setSaveFailed(false)
    setDeleting(undefined)
    setEdit({
      ...(prompt !== undefined && { previous: prompt }),
      title: prompt?.title ?? '',
      body: prompt?.body ?? '',
      tags: prompt?.tags.join(', ') ?? '',
      scope: prompt?.scope ?? 'user',
    })
  }
  const saveDraft = async () => {
    if (edit === undefined || isSaving) return
    setSaving(true)
    setSaveFailed(false)
    try {
      const saved = await props.port.save(
        {
          title: edit.title,
          body: edit.body,
          tags: edit.tags
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          scope: edit.scope,
        },
        edit.previous,
      )
      setEdit((current) => (current === edit ? { ...current, previous: saved } : current))
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }
  const preview = props.importPreview
  return (
    <Modal
      title={UI_TEXT.promptLibrary}
      titleId="prompt-library-title"
      isWide
      onClose={props.onClose}
    >
      <div className="prompt-library">
        <p>{UI_TEXT.promptSecretsNote}</p>
        {props.error === undefined ? null : <p role="alert">{props.error}</p>}
        {saveFailed ? <p role="alert">{UI_TEXT.promptFileInvalid}</p> : null}
        {preview === undefined ? null : (
          <section aria-label={UI_TEXT.sharePreview}>
            <p>{UI_TEXT.promptUntrusted}</p>
            <h3>{preview.prompt.title}</h3>
            <pre>{preview.prompt.body}</pre>
            <p>
              {UI_TEXT.promptVariables}:{' '}
              {preview.variables.map((variable) => variable.name).join(', ')}
            </p>
            <button
              type="button"
              onClick={() => {
                props.port.acceptImport(preview.id)
              }}
            >
              {UI_TEXT.promptImportConfirm}
            </button>
          </section>
        )}
        {props.sharePreview === undefined ? null : (
          <section aria-label={UI_TEXT.sharePreview}>
            <p>{UI_TEXT.shareReviewPrivacy}</p>
            <pre>
              <SharePreviewText text={props.sharePreview.text} />
            </pre>
            <button
              type="button"
              onClick={() => {
                if (props.sharePreview !== undefined) props.port.confirmShare(props.sharePreview.id)
              }}
            >
              {UI_TEXT.shareConfirm}
            </button>
          </section>
        )}
        <label>
          {UI_TEXT.promptSearch}
          <input
            ref={search}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
        </label>
        <label>
          {UI_TEXT.promptTags}
          <select
            value={tag}
            onChange={(event) => {
              setTag(event.target.value)
            }}
          >
            <option value="">{UI_TEXT.promptTags}</option>
            {tags.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="prompt-library-actions">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => {
              startEdit()
            }}
          >
            {UI_TEXT.promptSave}
          </button>
          <button
            type="button"
            onClick={() => {
              props.port.importPrompt('file')
            }}
          >
            {UI_TEXT.promptFromFile}
          </button>
          {props.canImportLinks ? (
            <button
              type="button"
              onClick={() => {
                props.port.importPrompt('link')
              }}
            >
              {UI_TEXT.promptLink}
            </button>
          ) : null}
        </div>
        {edit === undefined ? null : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void saveDraft()
            }}
          >
            <label>
              {UI_TEXT.promptTitle}
              <input
                required
                disabled={isSaving}
                maxLength={PROMPT_LIMITS.title}
                value={edit.title}
                onChange={(event) => {
                  setEdit({ ...edit, title: event.target.value })
                }}
              />
            </label>
            <label>
              {UI_TEXT.promptBody}
              <textarea
                required
                disabled={isSaving}
                maxLength={PROMPT_LIMITS.body}
                value={edit.body}
                onChange={(event) => {
                  setEdit({ ...edit, body: event.target.value })
                }}
              />
            </label>
            <label>
              {UI_TEXT.promptTags}
              <input
                disabled={isSaving}
                value={edit.tags}
                onChange={(event) => {
                  setEdit({ ...edit, tags: event.target.value })
                }}
              />
            </label>
            {edit.previous === undefined && props.hasWorkspace ? (
              <select
                disabled={isSaving}
                aria-label={UI_TEXT.promptScopeWorkspace}
                value={edit.scope}
                onChange={(event) => {
                  setEdit({ ...edit, scope: event.target.value === 'user' ? 'user' : 'workspace' })
                }}
              >
                <option value="user">{UI_TEXT.promptScopeUser}</option>
                <option value="workspace">{UI_TEXT.promptScopeWorkspace}</option>
              </select>
            ) : null}
            <button type="submit" disabled={isSaving}>
              {UI_TEXT.promptSave}
            </button>
            <button
              type="button"
              onClick={() => {
                setEdit(undefined)
              }}
            >
              {UI_TEXT.goalEditCancel}
            </button>
          </form>
        )}
        {deleting === undefined ? null : (
          <section aria-label={UI_TEXT.promptDeleteConfirm}>
            <p>
              {UI_TEXT.promptDeleteConfirm} {deleting.title}
            </p>
            <button
              type="button"
              onClick={() => {
                props.port.remove(deleting)
                setDeleting(undefined)
              }}
            >
              {UI_TEXT.promptDelete}
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleting(undefined)
              }}
            >
              {UI_TEXT.goalEditCancel}
            </button>
          </section>
        )}
        {rows.length === 0 ? (
          <p>{UI_TEXT.promptEmpty}</p>
        ) : (
          <ul className="palette-list" aria-label={UI_TEXT.promptLibrary}>
            {rows.map((prompt) => (
              <li key={`${prompt.scope}:${prompt.id}`}>
                <h3>{prompt.title}</h3>
                <p>
                  {prompt.scope === 'user' ? UI_TEXT.promptScopeUser : UI_TEXT.promptScopeWorkspace}{' '}
                  · {prompt.tags.join(', ')}
                </p>
                {prompt.untrusted ? <p>{UI_TEXT.promptUntrusted}</p> : null}
                <button
                  type="button"
                  onClick={() => {
                    props.port.insert(prompt)
                  }}
                >
                  {UI_TEXT.promptInsert}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    props.port.run(prompt)
                  }}
                >
                  {UI_TEXT.promptRun}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    startEdit(prompt)
                  }}
                >
                  {UI_TEXT.promptEdit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleting(prompt)
                  }}
                >
                  {UI_TEXT.promptDelete}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    props.port.duplicate(prompt, prompt.scope)
                  }}
                >
                  {UI_TEXT.promptDuplicate}
                </button>
                {prompt.scope === 'workspace' ? (
                  <button
                    type="button"
                    onClick={() => {
                      props.port.duplicate(prompt, 'user')
                    }}
                  >
                    {UI_TEXT.promptCopyToUser}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    props.port.share(prompt)
                  }}
                >
                  {UI_TEXT.sharePrompt}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

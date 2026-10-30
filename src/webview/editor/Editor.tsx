import { useEffect, useRef } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { mountDiff, mountEditor, type MountedEditor } from './codemirror.mjs'

/** CodeMirror's own panel words, in the display language (D33). Read at
mount time, never at module load, so the installed table is the one used. */
export function editorPhrases(): Record<string, string> {
  const text = UI_TEXT.editorGroup
  return {
    'Control character': UI_TEXT.nodeWorkspace.controlCharacter,
    'Selection deleted': UI_TEXT.nodeWorkspace.selectionDeleted,
    Find: text.findLabel,
    Replace: text.replaceLabel,
    replace: text.replaceOne,
    'replace all': text.replaceAll,
    next: text.nextMatch,
    previous: text.previousMatch,
    all: text.selectAllMatches,
    close: text.closePanel,
    'match case': text.matchCase,
    'by word': text.byWord,
    regexp: text.regexp,
    'Go to line': text.goToLine,
    go: text.go,
    'current match': text.currentMatch,
    'on line': text.onLine,
    'replaced $ matches': text.replacedMatches,
    'replaced match on line $': text.replacedMatchOnLine,
  }
}

export interface EditorProps {
  readonly text: string
  readonly label: string
  readonly languageId: string | null
  readonly minimap: boolean
  readonly onChange: (text: string) => void
  readonly onCursor: (cursor: { readonly line: number; readonly column: number }) => void
  readonly onLanguageFailed: (languageId: string) => void
  /** Stable identity of this pane's editor for the group's handle map. */
  readonly handleId: string
  /** Receives the mounted editor (and null on unmount) from the effect,
  so the group can drive find and the minimap without render-time refs. */
  readonly onHandle: (id: string, handle: MountedEditor | null) => void
}

/** One file's editor. Uncontrolled, like the node editor before it: the
parent remounts it (by key) when the buffer is replaced from outside. */
export function Editor(props: EditorProps) {
  const parent = useRef<HTMLDivElement>(null)
  const initial = useRef(props.text)
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  const appliedLanguage = useRef(props.languageId)
  const appliedMinimap = useRef(props.minimap)
  const handle = useRef<MountedEditor | null>(null)
  const { handleId, onHandle } = props

  useEffect(() => {
    if (parent.current === null) return
    const editor = mountEditor(parent.current, {
      text: initial.current,
      label: latest.current.label,
      languageId: appliedLanguage.current,
      readOnly: false,
      minimap: appliedMinimap.current,
      phrases: editorPhrases(),
      onChange: (text) => {
        latest.current.onChange(text)
      },
      onCursor: (cursor) => {
        latest.current.onCursor(cursor)
      },
      onLanguageFailed: (languageId) => {
        latest.current.onLanguageFailed(languageId)
      },
    })
    handle.current = editor
    onHandle(handleId, editor)
    return () => {
      if (handle.current === editor) handle.current = null
      onHandle(handleId, null)
      editor.destroy()
    }
  }, [handleId, onHandle])

  useEffect(() => {
    if (appliedLanguage.current === props.languageId) return
    appliedLanguage.current = props.languageId
    handle.current?.setLanguage(props.languageId)
  }, [props.languageId])

  useEffect(() => {
    if (appliedMinimap.current === props.minimap) return
    appliedMinimap.current = props.minimap
    handle.current?.setMinimap(props.minimap)
  }, [props.minimap])

  return <div className="ms-editor" ref={parent} />
}

export function EditorDiff({
  original,
  modified,
  languageId,
  onLanguageFailed,
}: {
  readonly original: string
  readonly modified: string
  readonly languageId: string | null
  readonly onLanguageFailed: (languageId: string) => void
}) {
  const parent = useRef<HTMLDivElement>(null)
  const latest = useRef(onLanguageFailed)
  useEffect(() => {
    latest.current = onLanguageFailed
  })
  useEffect(() => {
    if (parent.current === null) return
    const diff = mountDiff(parent.current, original, modified, {
      originalLabel: UI_TEXT.nodeWorkspace.original,
      modifiedLabel: UI_TEXT.nodeWorkspace.modified,
      languageId,
      phrases: editorPhrases(),
      onLanguageFailed: (failed) => {
        latest.current(failed)
      },
    })
    return () => {
      diff.destroy()
    }
  }, [original, modified, languageId])
  return <div className="ms-editor-diff node-diff" ref={parent} />
}

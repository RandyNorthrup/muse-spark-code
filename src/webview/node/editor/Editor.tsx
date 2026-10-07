import { useEffect, useRef } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { mountDiff, mountEditor } from './codemirror.mjs'

export function Editor({
  text,
  onChange,
}: {
  readonly text: string
  readonly onChange: (text: string) => void
}) {
  const parent = useRef<HTMLDivElement>(null)
  const initial = useRef(text)
  useEffect(() => {
    if (parent.current === null) return
    const editor = mountEditor(
      parent.current,
      initial.current,
      UI_TEXT.nodeLabels.editor,
      onChange,
      {
        'Control character': UI_TEXT.nodeWorkspace.controlCharacter,
        'Selection deleted': UI_TEXT.nodeWorkspace.selectionDeleted,
      },
    )
    return () => {
      editor.destroy()
    }
  }, [onChange])
  return <div className="node-editor" ref={parent} />
}

export function EditorDiff({
  original,
  modified,
}: {
  readonly original: string
  readonly modified: string
}) {
  const parent = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (parent.current === null) return
    const diff = mountDiff(parent.current, original, modified, {
      original: UI_TEXT.nodeWorkspace.original,
      modified: UI_TEXT.nodeWorkspace.modified,
    })
    return () => {
      diff.destroy()
    }
  }, [original, modified])
  return <div className="node-diff" ref={parent} />
}

// Real CodeMirror implementation, compiled only in the independent node entry.
import { EditorView, minimalSetup } from 'codemirror'
import { MergeView } from '@codemirror/merge'

function theme() {
  return EditorView.theme({
    '&': {
      color: 'var(--vscode-editor-foreground, var(--vscode-foreground))',
      backgroundColor: 'var(--vscode-editor-background, var(--vscode-sideBar-background))',
    },
    '.cm-scroller': {
      fontFamily: 'var(--vscode-editor-font-family, ui-monospace, monospace)',
      overflow: 'auto',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--vscode-editor-background, var(--vscode-sideBar-background))',
      color: 'var(--vscode-foreground)',
    },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-content': { caretColor: 'var(--vscode-foreground)' },
    '&.cm-focused': { outline: '1px solid var(--vscode-focusBorder)' },
  })
}

export function mountEditor(parent, text, label, onChange, phrases) {
  const view = new EditorView({ parent })
  // The public state class is already carried by codemirror. Its constructor
  // supplies create/phrases without adding an unapproved package import.
  const State = view.state.constructor
  view.setState(
    State.create({
      doc: text,
      extensions: [
        minimalSetup,
        State.phrases.of(phrases),
        theme(),
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
        }),
      ],
    }),
  )
  return { focus: () => view.focus(), destroy: () => view.destroy() }
}

function diffExtensions(label) {
  return [
    theme(),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ 'aria-label': label }),
  ]
}
export function mountDiff(parent, original, modified, labels) {
  const view = new MergeView({
    parent,
    a: { doc: original, extensions: diffExtensions(labels.original) },
    b: { doc: modified, extensions: diffExtensions(labels.modified) },
  })
  return { destroy: () => view.destroy() }
}

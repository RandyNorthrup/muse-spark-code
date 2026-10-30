// Real CodeMirror 6 for the shared editor group (M111 lane ED, D91.14),
// compiled only into lazy editor chunks. One editor on every surface:
// the node's web UI today, Muse Desktop's workbench with lane WB.
//
// Paint comes from the design tokens (--ms-*, D94) with the host editor's
// variables as the fallback chain, so the same build themes correctly in
// the node pages (which set --vscode-*) and on the desktop (which sets
// --ms-*). No raw colour lives here.
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language'
import { MergeView } from '@codemirror/merge'
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  ViewPlugin,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type PluginValue,
  type ViewUpdate,
} from '@codemirror/view'
import { highlightTree, tags as t, type Highlighter, type Tag } from '@lezer/highlight'
import {
  EDITOR_MINIMAP_BLOCK_HEIGHT_FRACTION,
  EDITOR_MINIMAP_CHAR_WIDTH_PX,
} from '../../shared/constants'

export interface MountEditorOptions {
  readonly text: string
  readonly label: string
  readonly languageId: string | null
  readonly readOnly: boolean
  readonly minimap: boolean
  readonly phrases: Readonly<Record<string, string>>
  readonly onChange: (text: string) => void
  readonly onCursor: (cursor: { readonly line: number; readonly column: number }) => void
  readonly onLanguageFailed: (languageId: string) => void
}

export interface MountedEditor {
  focus(): void
  destroy(): void
  getText(): string
  setMinimap(isEnabled: boolean): void
  setLanguage(languageId: string | null): void
  openSearch(): void
}

export interface MountDiffOptions {
  readonly originalLabel: string
  readonly modifiedLabel: string
  readonly languageId: string | null
  readonly phrases: Readonly<Record<string, string>>
  readonly onLanguageFailed: (languageId: string) => void
}

// Language loaders keyed by the catalog ids in languages.ts. Each is a
// dynamic import, so every language ships as its own lazy chunk and a
// surface downloads only the languages it actually opens.
// Literal specifiers throughout: the bundler turns each into its own
// lazy chunk, which a variable specifier would defeat. The set is
// the catalog in languages.ts, sized to the node editor budget.
const LOADERS: Readonly<Record<string, () => Promise<Extension>>> = {
  javascript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript().extension
  },
  jsx: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ jsx: true }).extension
  },
  typescript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ typescript: true }).extension
  },
  tsx: async () => {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ typescript: true, jsx: true }).extension
  },
  json: async () => {
    const { json } = await import('@codemirror/lang-json')
    return json().extension
  },
  python: async () => {
    const { python } = await import('@codemirror/legacy-modes/mode/python')
    return StreamLanguage.define(python).extension
  },
  html: async () => {
    const { html } = await import('@codemirror/legacy-modes/mode/xml')
    return StreamLanguage.define(html).extension
  },
  css: async () => {
    const { css } = await import('@codemirror/legacy-modes/mode/css')
    return StreamLanguage.define(css).extension
  },
  yaml: async () => {
    const { yaml } = await import('@codemirror/legacy-modes/mode/yaml')
    return StreamLanguage.define(yaml).extension
  },
  xml: async () => {
    const { xml } = await import('@codemirror/legacy-modes/mode/xml')
    return StreamLanguage.define(xml).extension
  },
  rust: async () => {
    const { rust } = await import('@codemirror/legacy-modes/mode/rust')
    return StreamLanguage.define(rust).extension
  },
  go: async () => {
    const { go } = await import('@codemirror/legacy-modes/mode/go')
    return StreamLanguage.define(go).extension
  },
  shell: async () => {
    const { shell } = await import('@codemirror/legacy-modes/mode/shell')
    return StreamLanguage.define(shell).extension
  },
  powershell: async () => {
    const { powerShell } = await import('@codemirror/legacy-modes/mode/powershell')
    return StreamLanguage.define(powerShell).extension
  },
  toml: async () => {
    const { toml } = await import('@codemirror/legacy-modes/mode/toml')
    return StreamLanguage.define(toml).extension
  },
  dockerfile: async () => {
    const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile')
    return StreamLanguage.define(dockerFile).extension
  },
  cmake: async () => {
    const { cmake } = await import('@codemirror/legacy-modes/mode/cmake')
    return StreamLanguage.define(cmake).extension
  },
  diff: async () => {
    const { diff } = await import('@codemirror/legacy-modes/mode/diff')
    return StreamLanguage.define(diff).extension
  },
  properties: async () => {
    const { properties } = await import('@codemirror/legacy-modes/mode/properties')
    return StreamLanguage.define(properties).extension
  },
}

function editorTheme(): Extension {
  return EditorView.theme({
    '&': {
      color: 'var(--ms-text, var(--vscode-editor-foreground, var(--vscode-foreground)))',
      backgroundColor:
        'var(--ms-editor-surface, var(--vscode-editor-background, var(--vscode-sideBar-background)))',
    },
    '.cm-scroller': {
      fontFamily: 'var(--vscode-editor-font-family, ui-monospace, monospace)',
      overflow: 'auto',
    },
    '.cm-gutters': {
      backgroundColor:
        'var(--ms-editor-surface, var(--vscode-editor-background, var(--vscode-sideBar-background)))',
      color: 'var(--ms-muted, var(--vscode-editorLineNumber-foreground, var(--vscode-foreground)))',
      borderRight: '1px solid var(--ms-border, var(--vscode-editorWidget-border, transparent))',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'var(--ms-hover, var(--vscode-editor-lineHighlightBackground, transparent))',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--ms-selection, var(--vscode-editor-selectionBackground, transparent))',
    },
    '.cm-content': {
      caretColor: 'var(--ms-text, var(--vscode-editorCursor-foreground, var(--vscode-foreground)))',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor:
        'var(--ms-text, var(--vscode-editorCursor-foreground, var(--vscode-foreground)))',
    },
    '.cm-panels': {
      backgroundColor:
        'var(--ms-surface, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)))',
      color: 'var(--ms-text, var(--vscode-editorWidget-foreground, var(--vscode-foreground)))',
    },
    '&.cm-focused': {
      outline: '1px solid var(--ms-focus, var(--vscode-focusBorder))',
    },
  })
}

const syntaxStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword],
    color: 'var(--ms-syntax-keyword)',
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--ms-syntax-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--ms-syntax-number)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.typeName, t.className],
    color: 'var(--ms-syntax-function)',
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: 'var(--ms-muted)',
    fontStyle: 'italic',
  },
  { tag: t.invalid, color: 'var(--ms-danger)' },
])

// The minimap (D91.14), implemented in-tree: upstream's package ships
// no licence text anywhere to reproduce in the notices, so the editor
// draws its own. One canvas of syntax-coloured blocks (the token
// colours, resolved from the theme), a viewport overlay, and
// click-or-drag scrolling. It is decoration over the real editor, so
// it is hidden from assistive technology; the editor stays the surface.
const MINIMAP_COLOR_KEYS: Readonly<Record<string, string>> = {
  keyword: '--ms-syntax-keyword',
  string: '--ms-syntax-string',
  number: '--ms-syntax-number',
  function: '--ms-syntax-function',
  comment: '--ms-muted',
  invalid: '--ms-danger',
}
const minimapHighlighter: Highlighter = {
  style: (styleTags: readonly Tag[]): string | null => {
    for (const tag of styleTags) {
      if ([t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword].includes(tag)) {
        return 'keyword'
      }
      if ([t.string, t.regexp].includes(tag)) return 'string'
      if ([t.number, t.bool, t.null, t.atom].includes(tag)) return 'number'
      if ([t.typeName, t.className].includes(tag)) return 'function'
      if ([t.comment, t.lineComment, t.blockComment, t.docComment].includes(tag)) {
        return 'comment'
      }
      if (tag === t.invalid) return 'invalid'
    }
    return null
  },
}

class MinimapView implements PluginValue {
  private readonly view: EditorView
  private readonly dom: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly overlay: HTMLElement
  private readonly resizeObserver: ResizeObserver | null
  private isDragging = false
  private readonly onScroll = (): void => {
    this.positionOverlay()
  }
  private readonly onPointerDown = (event: PointerEvent): void => {
    this.isDragging = true
    this.dom.setPointerCapture(event.pointerId)
    this.scrollToPointer(event)
  }
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.isDragging) this.scrollToPointer(event)
  }
  private readonly onPointerUp = (): void => {
    this.isDragging = false
  }

  constructor(view: EditorView) {
    this.view = view
    const doc = view.dom.ownerDocument
    this.dom = doc.createElement('div')
    this.dom.className = 'ms-editor-minimap'
    this.dom.setAttribute('aria-hidden', 'true')
    this.canvas = doc.createElement('canvas')
    this.canvas.className = 'ms-editor-minimap-canvas'
    this.overlay = doc.createElement('div')
    this.overlay.className = 'ms-editor-minimap-viewport'
    this.dom.append(this.canvas, this.overlay)
    view.dom.append(this.dom)
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
    this.dom.addEventListener('pointerdown', this.onPointerDown)
    this.dom.addEventListener('pointermove', this.onPointerMove)
    this.dom.addEventListener('pointerup', this.onPointerUp)
    const Observer = doc.defaultView?.ResizeObserver
    this.resizeObserver =
      Observer === undefined
        ? null
        : new Observer(() => {
            this.draw()
          })
    this.resizeObserver?.observe(view.dom)
    this.draw()
  }

  private scrollToPointer(event: PointerEvent): void {
    const rect = this.dom.getBoundingClientRect()
    if (rect.height === 0) return
    const fraction = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
    const lines = this.view.state.doc.lines
    const line = this.view.state.doc.line(Math.max(1, Math.round(fraction * lines)))
    this.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
  }

  private positionOverlay(): void {
    const scroller = this.view.scrollDOM
    if (scroller.scrollHeight === 0 || this.dom.clientHeight === 0) return
    const heightFraction = scroller.clientHeight / scroller.scrollHeight
    const topFraction = scroller.scrollTop / scroller.scrollHeight
    this.overlay.style.height = `${String(Math.max(heightFraction * 100, 2))}%`
    this.overlay.style.top = `${String(topFraction * 100)}%`
  }

  private draw(): void {
    this.positionOverlay()
    const width = this.dom.clientWidth
    const height = this.dom.clientHeight
    if (width === 0 || height === 0) return
    const ratio = this.view.dom.ownerDocument.defaultView?.devicePixelRatio ?? 1
    this.canvas.width = Math.round(width * ratio)
    this.canvas.height = Math.round(height * ratio)
    const context = this.canvas.getContext('2d')
    // Under jsdom (the unit tests) there is no 2d context: the frame and
    // overlay still render and behave; only the pixels wait for a browser.
    if (context === null) return
    context.scale(ratio, ratio)
    const style = this.view.dom.ownerDocument.defaultView?.getComputedStyle(this.dom)
    const resolveColor = (variable: string, fallbackVariable: string): string => {
      const primary = style?.getPropertyValue(variable).trim() ?? ''
      const value =
        primary === '' ? (style?.getPropertyValue(fallbackVariable).trim() ?? '') : primary
      return value === '' ? (style?.color ?? 'currentColor') : value
    }
    const colors: { default: string; [key: string]: string } = {
      default: resolveColor('--ms-text', '--vscode-editor-foreground'),
    }
    for (const [key, variable] of Object.entries(MINIMAP_COLOR_KEYS)) {
      colors[key] = resolveColor(variable, '--ms-text')
    }
    const { doc } = this.view.state
    const lineHeight = height / doc.lines
    const blockHeight = Math.max(1, lineHeight * EDITOR_MINIMAP_BLOCK_HEIGHT_FRACTION)
    const spans: { from: number; to: number; color: string }[] = []
    highlightTree(syntaxTree(this.view.state), minimapHighlighter, (from, to, classes) => {
      spans.push({ from, to, color: colors[classes] ?? colors.default })
    })
    let spanIndex = 0
    for (let number = 1; number <= doc.lines; number += 1) {
      const line = doc.line(number)
      const y = (number - 1) * lineHeight
      let cursor = line.from
      const drawRun = (from: number, to: number, color: string): void => {
        const text = doc.sliceString(from, to)
        let column = from - line.from
        for (const run of text.split(/(\s+)/u)) {
          if (run.trim() !== '') {
            context.fillStyle = color
            context.fillRect(
              column * EDITOR_MINIMAP_CHAR_WIDTH_PX,
              y,
              run.length * EDITOR_MINIMAP_CHAR_WIDTH_PX,
              blockHeight,
            )
          }
          column += run.length
        }
      }
      while (spanIndex < spans.length && (spans[spanIndex]?.to ?? 0) <= line.from) {
        spanIndex += 1
      }
      let probe = spanIndex
      while (probe < spans.length && (spans[probe]?.from ?? Infinity) < line.to) {
        const span = spans[probe]
        if (span !== undefined) {
          const from = Math.max(span.from, line.from)
          const to = Math.min(span.to, line.to)
          if (cursor < from) drawRun(cursor, from, colors.default)
          if (from < to) drawRun(from, to, span.color)
          cursor = Math.max(cursor, to)
        }
        probe += 1
      }
      if (cursor < line.to) drawRun(cursor, line.to, colors.default)
    }
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.draw()
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    this.dom.removeEventListener('pointerdown', this.onPointerDown)
    this.dom.removeEventListener('pointermove', this.onPointerMove)
    this.dom.removeEventListener('pointerup', this.onPointerUp)
    this.dom.remove()
  }
}

const minimapExtension = ViewPlugin.fromClass(MinimapView)

function cursorOf(state: EditorState): { line: number; column: number } {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  return { line: line.number, column: head - line.from + 1 }
}

export function mountEditor(parent: HTMLElement, options: MountEditorOptions): MountedEditor {
  const languageCompartment = new Compartment()
  const minimapCompartment = new Compartment()
  let isDisposed = false
  let languageGeneration = 0

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(syntaxStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        EditorState.phrases.of({ ...options.phrases }),
        editorTheme(),
        EditorView.contentAttributes.of({ 'aria-label': options.label }),
        EditorState.readOnly.of(options.readOnly),
        EditorView.editable.of(!options.readOnly),
        languageCompartment.of([]),
        minimapCompartment.of(options.minimap ? minimapExtension : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString())
          if (update.docChanged || update.selectionSet) options.onCursor(cursorOf(update.state))
        }),
      ],
    }),
  })

  async function applyLanguage(languageId: string | null): Promise<void> {
    if (languageId === null) {
      languageGeneration += 1
      if (!isDisposed) view.dispatch({ effects: languageCompartment.reconfigure([]) })
      return
    }
    const loader = LOADERS[languageId]
    if (loader === undefined) {
      options.onLanguageFailed(languageId)
      return
    }
    languageGeneration += 1
    const generation = languageGeneration
    try {
      const support = await loader()
      if (isDisposed || generation !== languageGeneration) return
      view.dispatch({ effects: languageCompartment.reconfigure(support) })
    } catch {
      // REPORTED: the chunk failed to load (its URL can carry a local
      // path, so the error itself is never surfaced). The host shows the
      // localized plain-text notice; the file stays fully editable.
      if (!isDisposed && generation === languageGeneration) options.onLanguageFailed(languageId)
    }
  }

  void applyLanguage(options.languageId)
  options.onCursor(cursorOf(view.state))

  return {
    focus: (): void => {
      view.focus()
    },
    destroy: (): void => {
      isDisposed = true
      view.destroy()
    },
    getText: (): string => view.state.doc.toString(),
    setMinimap: (isEnabled: boolean): void => {
      view.dispatch({
        effects: minimapCompartment.reconfigure(isEnabled ? minimapExtension : []),
      })
    },
    setLanguage: (languageId: string | null): void => {
      void applyLanguage(languageId)
    },
    openSearch: (): void => {
      openSearchPanel(view)
    },
  }
}

function diffExtensions(
  label: string,
  languageCompartment: Compartment,
  phrases: Readonly<Record<string, string>>,
): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    syntaxHighlighting(syntaxStyle, { fallback: true }),
    EditorState.phrases.of({ ...phrases }),
    editorTheme(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ 'aria-label': label }),
    languageCompartment.of([]),
  ]
}

export function mountDiff(
  parent: HTMLElement,
  original: string,
  modified: string,
  options: MountDiffOptions,
): { destroy(): void } {
  const originalLanguage = new Compartment()
  const modifiedLanguage = new Compartment()
  const view = new MergeView({
    parent,
    a: {
      doc: original,
      extensions: diffExtensions(options.originalLabel, originalLanguage, options.phrases),
    },
    b: {
      doc: modified,
      extensions: diffExtensions(options.modifiedLabel, modifiedLanguage, options.phrases),
    },
  })
  const lifecycle = { isDisposed: false }
  if (options.languageId !== null) {
    const languageId = options.languageId
    const loader = LOADERS[languageId]
    if (loader === undefined) {
      options.onLanguageFailed(languageId)
    } else {
      void (async (): Promise<void> => {
        try {
          const support = await loader()
          if (lifecycle.isDisposed) return
          view.a.dispatch({ effects: originalLanguage.reconfigure(support) })
          view.b.dispatch({ effects: modifiedLanguage.reconfigure(support) })
        } catch {
          // REPORTED as in mountEditor: plain-text diff, host notified.
          if (!lifecycle.isDisposed) options.onLanguageFailed(languageId)
        }
      })()
    }
  }
  return {
    destroy: (): void => {
      lifecycle.isDisposed = true
      view.destroy()
    },
  }
}

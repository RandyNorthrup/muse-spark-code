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
  setMinimap(on: boolean): void
  setLanguage(languageId: string | null): void
  openSearch(): void
}

export function mountEditor(parent: HTMLElement, options: MountEditorOptions): MountedEditor

export interface MountDiffOptions {
  readonly originalLabel: string
  readonly modifiedLabel: string
  readonly languageId: string | null
  readonly phrases: Readonly<Record<string, string>>
  readonly onLanguageFailed: (languageId: string) => void
}

export function mountDiff(
  parent: HTMLElement,
  original: string,
  modified: string,
  options: MountDiffOptions,
): { destroy(): void }

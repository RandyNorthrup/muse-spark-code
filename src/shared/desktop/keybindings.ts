// Muse Desktop (M111, D91.12) lane WB: the keybinding registry the rail's
// labels read and the workbench dispatches from. Chords follow VS Code's
// default keymap on Linux (Ctrl is written ctrl, Cmd as meta).

export interface Keybinding {
  readonly command: string
  readonly chord: string
  readonly when?: string
}

export const WORKBENCH_COMMANDS = [
  'workbench.quickOpen',
  'workbench.toggleSidebar',
  'workbench.toggleRail',
  'workbench.toggleTerminal',
  'workbench.newTerminal',
  'workbench.splitTerminal',
  'workbench.killTerminal',
  'workbench.detachTerminal',
  'workbench.dockTerminal',
  'workbench.collapseTerminal',
  'workbench.pinTerminal',
  'workbench.panelTaller',
  'workbench.panelShorter',
  'workbench.terminalSearch',
  'workbench.focusChat',
  'workbench.focusEditor',
  'workbench.focusTerminal',
  'workbench.focusProblems',
  'workbench.focusOutput',
  'workbench.focusSidebar',
  'workbench.saveFile',
  'workbench.closeFile',
  'workbench.nextFile',
  'workbench.previousFile',
] as const
export type WorkbenchCommand = (typeof WORKBENCH_COMMANDS)[number]

// Lane BP (D91.13): shortcuts for toggle, focus, new, split and detach —
// VS Code's where it has one (split is Ctrl+Shift+5 there; detach has no
// classic chord, so the panel's own Ctrl+Alt+D). The dispatcher honours
// `when`: Ctrl+F finds in the terminal only while one has focus, as in
// VS Code, and Ctrl+S saves only from the editor. Commands without a
// chord below are registered for the launcher (SH2); the rail shows no
// label for them.
export const DEFAULT_KEYBINDINGS: readonly Keybinding[] = [
  { command: 'workbench.quickOpen', chord: 'ctrl+p' },
  { command: 'workbench.toggleSidebar', chord: 'ctrl+b' },
  { command: 'workbench.toggleRail', chord: 'ctrl+shift+b' },
  { command: 'workbench.toggleTerminal', chord: 'ctrl+`' },
  { command: 'workbench.newTerminal', chord: 'ctrl+shift+`' },
  { command: 'workbench.splitTerminal', chord: 'ctrl+shift+5' },
  { command: 'workbench.detachTerminal', chord: 'ctrl+alt+d' },
  { command: 'workbench.collapseTerminal', chord: 'ctrl+alt+c' },
  { command: 'workbench.panelTaller', chord: 'ctrl+alt+arrowup' },
  { command: 'workbench.panelShorter', chord: 'ctrl+alt+arrowdown' },
  { command: 'workbench.terminalSearch', chord: 'ctrl+f', when: 'terminalFocus' },
  { command: 'workbench.focusChat', chord: 'ctrl+1' },
  { command: 'workbench.focusEditor', chord: 'ctrl+2' },
  { command: 'workbench.focusTerminal', chord: 'ctrl+3' },
  { command: 'workbench.focusSidebar', chord: 'ctrl+4' },
  { command: 'workbench.saveFile', chord: 'ctrl+s', when: 'editorFocus' },
  { command: 'workbench.closeFile', chord: 'ctrl+w' },
  { command: 'workbench.nextFile', chord: 'ctrl+pagedown' },
  { command: 'workbench.previousFile', chord: 'ctrl+pageup' },
]

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const

// Canonicalises a chord so `Shift+Ctrl+P` and `ctrl+shift+p` are one key.
export function normaliseChord(chord: string): string {
  const parts = chord
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const modifiers = MODIFIER_ORDER.filter((modifier) => parts.includes(modifier))
  const keys = parts.filter((part) => !(MODIFIER_ORDER as readonly string[]).includes(part))
  return [...modifiers, ...keys].join('+')
}

export interface KeyboardChordEvent {
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
  readonly key: string
  readonly code?: string
}

// Physical-key names, as VS Code reads `code`: Shift+5 reports `%` in
// `key` on a US layout, so the digit chords (Ctrl+Shift+5, Ctrl+Shift+`)
// only match through `code`. Letters work across layouts the same way.
const CODE_KEY_NAMES: Readonly<Record<string, string>> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'space',
}

function keyFromCode(code: string): string | undefined {
  const named = CODE_KEY_NAMES[code]
  if (named !== undefined) return named
  if (/^Key[A-Z]$/.test(code)) return code.slice('Key'.length).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice('Digit'.length)
  if (/^Arrow(Up|Down|Left|Right)$/.test(code)) return code.toLowerCase()
  if (/^(PageUp|PageDown|Home|End|Enter|Escape|Tab|Delete|Insert)$/.test(code)) {
    return code.toLowerCase()
  }
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(code) ? code.toLowerCase() : undefined
}

export function chordFromEvent(event: KeyboardChordEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.metaKey) parts.push('meta')
  const coded = event.code === undefined ? undefined : keyFromCode(event.code)
  if (coded !== undefined) {
    // The physical key is unambiguous, so held modifiers are read as
    // held — Shift+Ctrl+P stays ctrl+shift+p, as normaliseChord writes
    // it, and Caps Lock never smuggles a shift into a chord.
    if (event.shiftKey) parts.push('shift')
    parts.push(coded)
    return normaliseChord(parts.join('+'))
  }
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase()
  // A shifted letter already reads as uppercase in `key`; digits and
  // punctuation keep an explicit shift, as VS Code writes ctrl+shift+`.
  const isNeedsShift =
    event.shiftKey &&
    (event.key.length !== 1 || event.key.toLowerCase() === event.key.toUpperCase())
  if (isNeedsShift) parts.push('shift')
  if (!(MODIFIER_ORDER as readonly string[]).includes(key)) parts.push(key)
  return normaliseChord(parts.join('+'))
}

function displayPart(part: string): string {
  if (part === 'ctrl') return 'Ctrl'
  if (part === 'alt') return 'Alt'
  if (part === 'shift') return 'Shift'
  if (part === 'meta') return 'Meta'
  return part.length === 1 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
}

export type WorkbenchFocus = 'editor' | 'terminal' | 'other'

/**
Whether a binding fires with this focus. A context nobody provides
never fires, as VS Code evaluates an unknown `when` false.
*/
export function isBindingActive(binding: Keybinding, focus: WorkbenchFocus): boolean {
  switch (binding.when) {
    case undefined: {
      return true
    }
    case 'editorFocus': {
      return focus === 'editor'
    }
    case 'terminalFocus': {
      return focus === 'terminal'
    }
    default: {
      return false
    }
  }
}

export class KeybindingRegistry {
  private readonly byChord = new Map<string, Keybinding>()
  private readonly byCommand = new Map<string, Keybinding>()
  private ordered: Keybinding[] = []

  public constructor(bindings: readonly Keybinding[] = DEFAULT_KEYBINDINGS) {
    for (const binding of bindings) this.register(binding)
  }

  // Registers a binding; a chord already bound to another command is
  // refused by name so the conflict is said, never silently shadowed.
  public register(binding: Keybinding): void {
    const chord = normaliseChord(binding.chord)
    const existing = this.byChord.get(chord)
    if (existing !== undefined && existing.command !== binding.command) {
      throw new Error(
        `Keybinding conflict: ${chord} is already bound to ${existing.command}, not ${binding.command}`,
      )
    }
    const entry: Keybinding = { ...binding, chord }
    this.byChord.set(chord, entry)
    this.byCommand.set(binding.command, entry)
    this.ordered = [...this.ordered.filter((item) => item.command !== entry.command), entry]
  }

  public commandForChord(chord: string): Keybinding | undefined {
    return this.byChord.get(normaliseChord(chord))
  }

  public chordForCommand(command: string): string | undefined {
    return this.byCommand.get(command)?.chord
  }

  // The label the rail shows beside an icon: the chord in display form.
  public labelForCommand(command: string): string | undefined {
    const chord = this.chordForCommand(command)
    return chord === undefined
      ? undefined
      : chord
          .split('+')
          .map((part) => displayPart(part))
          .join('+')
  }

  public list(): readonly Keybinding[] {
    return this.ordered
  }
}

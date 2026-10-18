// The empty composer's invitation (F67): a message first, then only this
// machine's focus key, in one line. Key names are not translated (the same
// physical keys in every language); macOS binds Cmd+Esc, Windows
// Ctrl+Alt+Esc (Ctrl+Esc opens Start there; M26, D29), elsewhere Ctrl+Esc.
// Pure, so the unit tests cover it without VS Code (as focusGate.ts does);
// `configureWebview` (webviewSetup.ts) is its only production reader.
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export function composerPlaceholderFor(platform: NodeJS.Platform): string {
  let shortcut = 'Ctrl+Esc'
  if (platform === 'darwin') {
    shortcut = 'Cmd+Esc'
  } else if (platform === 'win32') {
    shortcut = 'Ctrl+Alt+Esc'
  }
  return fill(UI_TEXT.composerPlaceholderWithShortcut, { shortcut })
}

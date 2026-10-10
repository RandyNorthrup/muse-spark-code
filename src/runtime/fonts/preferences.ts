// D94.3: shared by standalone web/desktop hosts; editor hosts keep their fonts.
import * as z from 'zod/mini'
import {
  FONT_CODE_CHOICES,
  FONT_PACK_ALIASES,
  FONT_UI_CHOICES,
  UI_TEXT,
} from '../../shared/constants'

export const fontPreferencesSchema = z.pipe(
  z.strictObject({
    ui: z.optional(z.enum(FONT_UI_CHOICES)),
    code: z.optional(z.enum(FONT_CODE_CHOICES)),
    ligatures: z.optional(z.boolean()),
  }),
  z.transform((value) => ({
    ui: value.ui ?? 'Inter',
    code: value.code ?? 'JetBrains Mono',
    ligatures: value.ligatures ?? false,
  })),
)
export type FontPreferences = z.infer<typeof fontPreferencesSchema>

/** The host persists validated preferences in its own user settings, never a workspace file. */
export interface FontPreferencesPort {
  read(): Promise<unknown>
  write(preferences: FontPreferences): Promise<void>
}

/** Existing token stacks come from D94's generated consumer JSON. */
export interface FontTokenPort {
  readonly uiFallback: string
  readonly codeFallback: string
  setProperty(name: string, value: string): void
}

export function applyFontPreferences(
  preferences: FontPreferences,
  host: 'editor' | 'standalone',
  tokens: FontTokenPort,
): void {
  if (host === 'editor') return
  tokens.setProperty(
    '--ms-font-ui',
    preferences.ui === 'system'
      ? 'system-ui, sans-serif'
      : `"${preferences.ui}", "${FONT_PACK_ALIASES[preferences.ui]}", ${tokens.uiFallback}`,
  )
  tokens.setProperty(
    '--ms-font-code',
    preferences.code === 'system'
      ? 'monospace'
      : `"${preferences.code}", "${FONT_PACK_ALIASES[preferences.code]}", ${tokens.codeFallback}`,
  )
  tokens.setProperty('--ms-code-ligatures', preferences.ligatures ? 'normal' : 'none')
  // Coding fonts commonly use contextual alternates (calt), which ligatures:none alone leaves on.
  tokens.setProperty(
    '--ms-code-font-features',
    preferences.ligatures ? 'normal' : '"calt" 0, "liga" 0, "clig" 0',
  )
}

/** Bind Settings controls to this port on companion/node/desktop; no host-specific storage. */
export async function fontAppearanceSettings(port: FontPreferencesPort) {
  const stored = await port.read()
  const preferences = fontPreferencesSchema.parse(stored ?? {})
  return {
    preferences,
    ui: { label: UI_TEXT.acpFontUi, choices: FONT_UI_CHOICES },
    code: { label: UI_TEXT.acpFontCode, choices: FONT_CODE_CHOICES },
    ligatures: { label: UI_TEXT.acpFontLigatures },
    systemLabel: UI_TEXT.acpFontSystem,
    async save(value: unknown): Promise<FontPreferences> {
      const validated = fontPreferencesSchema.parse(value)
      await port.write(validated)
      return validated
    },
  }
}

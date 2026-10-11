// The workspace suggestion (M95 lane K, PLAN.md D74, M95 acceptance 6): a
// workspace may only suggest a preset by id (`museSpark.suggestedProvider`,
// never a URL), which offers the panel with that preset chosen; nothing is
// configured until the user finishes it.

/**
 * The preset id a workspace suggests, or undefined when the setting is
 * empty, unknown, or URL-shaped (a workspace file can never set an
 * address: anything shaped like one is ignored).
 */
export function workspaceSuggestedPreset(
  settingValue: string | undefined,
  hasPreset: (id: string) => boolean,
): string | undefined {
  const id = (settingValue ?? '').trim()
  if (id === '' || /[:/\s]/.test(id)) {
    return undefined
  }
  return hasPreset(id) ? id : undefined
}

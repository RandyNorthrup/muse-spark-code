// Ctrl+Alt+F: flip the `museSpark.focusView` setting. The configuration change
// event then broadcasts the new snapshot to every open surface, so the command
// itself only touches settings.

export interface ToggleFocusViewDeps {
  readonly isFocusViewEnabled: () => boolean
  readonly setFocusViewEnabled: (isEnabled: boolean) => Thenable<void>
}

export async function toggleFocusView(deps: ToggleFocusViewDeps): Promise<void> {
  await deps.setFocusViewEnabled(!deps.isFocusViewEnabled())
}

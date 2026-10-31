// The macOS recording permissions' recovery: the Settings panes a refused
// permission offers. The refusal path carries this; the driver reaches it
// only for the permission names. Shared leaf, owned by neither bundle's
// file list.
export type MacosRecordingPermission = 'screen' | 'microphone'

const SCREEN_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
const MICROPHONE_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

/** Called only from the recovery action the user chose. */
export async function openMacosRecordingPermissions(
  permission: MacosRecordingPermission,
  openExternal: (uri: string) => Promise<void>,
): Promise<void> {
  await openExternal(permission === 'screen' ? SCREEN_SETTINGS : MICROPHONE_SETTINGS)
}

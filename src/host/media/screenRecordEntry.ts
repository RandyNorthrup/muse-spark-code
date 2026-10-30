// M105 lane W: the screen-recording bundle's entry. The activation bundle
// keeps only the port types and the lazy loader; the preview command and the
// platform drivers (macOS, Windows, Linux portal) load on first recording use.
export { runScreenRecordingCommand, openRecordingPreview } from './previewPanel'
export { findLatestRecording } from '../../core/media/record/linux'
export { createRecordingDriver } from './recordingDriver'
export {
  createLatestRecordingPort,
  createLinuxLatestPort,
  createMacosLatestPort,
  createWindowsLatestPort,
  createWindowsPrivateDirectory,
  isScreenshotRecordingName,
  resolveWindowsRecordingFolders,
} from './recordingLatest'
export type { RecordingCommandDeps, RecordingPreviewDeps } from './screenRecordBundle'
export type { ScreenRecordingPreview } from '../../core/media/record/driver'

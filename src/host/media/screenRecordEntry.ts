// M105 lane W: the screen-recording bundle's entry. The activation bundle
// keeps only the port types and the lazy loader; the preview command and
// the latest-file discovery load on first recording use, and the platform
// drivers (macOS, Windows, Linux portal) later still, on the first start.
export { runScreenRecordingCommand, openRecordingPreview } from '../vscode/media/previewPanel'
export { findLatestRecording } from '../../core/media/record/latest'
export { createRecordingDriver } from './recordingDriverLoader'
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

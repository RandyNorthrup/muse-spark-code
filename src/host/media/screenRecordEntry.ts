// M105 lane W: the screen-recording bundle's entry. The activation bundle
// keeps only the port types and the lazy loader; the preview command and the
// R1-R3 platform drivers load on first recording use.
export { runScreenRecordingCommand, openRecordingPreview } from './previewPanel'
export { macosScreenRecordingDriver } from '../../core/media/record/macos'
export { windowsScreenRecorder } from '../../core/media/record/windows'
export { linuxRecordingDriver } from '../../core/media/record/linux'
export type { RecordingCommandDeps, RecordingPreviewDeps } from './screenRecordBundle'
export type { ScreenRecordingPreview } from '../../core/media/record/driver'

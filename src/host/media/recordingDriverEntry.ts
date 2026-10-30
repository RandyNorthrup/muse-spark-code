// M105 RLF-RECORDING: the screen-recording drivers' deferred entry. The
// recording command's bundle carries the preview and the latest-file
// discovery; the platform drivers (Windows, macOS, the Linux portal) ship
// once in dist/screenRecordDrivers.js and load on the first recording
// start, never at activation and never for a preview.
export { createRecordingDriver } from './recordingDriver'

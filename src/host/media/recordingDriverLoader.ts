// M105 RLF-RECORDING: the screen-recording drivers' first-start loader.
// The drivers live in dist/screenRecordDrivers.js; this awaits that bundle
// and creates the platform's driver from it. The recording command calls it
// once per window and keeps the driver it returns.
import type { ScreenRecordingDriver } from '../../core/media/record/driver'
import type { RecordingDriverHost } from './recordingDriver'

/** The driver of this platform, or undefined where the product records nowhere. */
export async function createRecordingDriver(
  host: RecordingDriverHost,
): Promise<ScreenRecordingDriver | undefined> {
  // Rewritten to the drivers bundle by the deferred build cohort; the unit
  // tests import the entry's real module instead.
  const drivers = await import('./recordingDriverEntry')
  return drivers.createRecordingDriver(host)
}

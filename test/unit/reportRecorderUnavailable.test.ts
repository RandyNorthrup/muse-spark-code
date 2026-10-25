// The flight recorder's unavailable journal (src/host/support/reportRecorder.ts)
// is a kept failure: a journal that cannot load reaches the host's
// `onUnavailable` with the original error, and recording stays off.
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ReportRecorder } from '../../src/host/support/reportRecorder'

it('hands the real load failure over and records nothing', async () => {
  const unavailable: unknown[] = []
  const missing = path.join(tmpdir(), `no-such-journal-${String(process.pid)}.js`)
  const loadMissing = async (): Promise<never> => {
    // The real refusal: the journal file is not there to load.
    await readFile(missing)
    throw new Error('the journal file was there after all')
  }
  const recorder = new ReportRecorder({
    load: loadMissing,
    now: () => Date.now(),
    onUnavailable: (error) => void unavailable.push(error),
  })
  await expect(recorder.start()).resolves.toBe(false)
  expect(unavailable).toHaveLength(1)
  const failure = unavailable[0]
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof Error && 'code' in failure ? String(failure.code) : undefined).toBe(
    'ENOENT',
  )
  // The report says why recording was unavailable: `unknown` until the capture
  // side names its reason (lane REPORTFLOW R2).
  await expect(recorder.readJournal()).resolves.toEqual({
    entries: [],
    recordingUnavailable: true,
    unavailableReason: 'unknown',
  })
})

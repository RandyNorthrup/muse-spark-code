// One uploaded-files report (and ledger double) for the suites driving the
// binding (M105 lane F): the same fixture everywhere, so the suites do not
// duplicate it.
import { vi } from 'vitest'
import type { UploadedFilesReport } from '../../../src/shared/media'

/** Two ledger files: ours and another app's, both unreferenced. */
export function uploadedFilesReportFixture(): UploadedFilesReport {
  return {
    provider: 'meta',
    isReadOnly: false,
    poolBytes: 100,
    usedBytes: 15,
    files: [
      {
        fileId: 'file-one',
        name: 'clip.mp4',
        bytes: 3,
        expiresAt: 1_800_000_000,
        ours: true,
        sessions: [],
      },
      {
        fileId: 'file-other',
        name: 'other.pdf',
        bytes: 12,
        expiresAt: 1_800_000_000,
        ours: false,
        sessions: [],
      },
    ],
  }
}

/** A counting ledger double over the shared report, for port-level suites. */
export function fakeUploadedFilesLedger(report: UploadedFilesReport) {
  return {
    read: vi.fn(() => Promise.resolve(report)),
    accountReport: vi.fn(() => Promise.resolve(report)),
    post: vi.fn(),
    deleteFile: vi.fn(() => Promise.resolve()),
    deleteAllOurs: vi.fn(() => Promise.resolve()),
    confirmForeign: vi.fn(() => Promise.resolve(false)),
  }
}

// One uploaded-files report (and ledger double) for the suites driving the
// binding (M105 lane F): the same fixture everywhere, so the suites do not
// duplicate it.
import { type Mock, vi } from 'vitest'
import type { AcpUploadsPort } from '../../../src/acp/uploads'
import type { UploadedFilesLedger } from '../../../src/core/media/uploadedFiles'
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

/** The counting ledger double's type: the port surface plus the posted report. */
export interface FakeUploadedFilesLedger extends AcpUploadsPort, UploadedFilesLedger {
  readonly read: Mock<(signal?: AbortSignal) => Promise<UploadedFilesReport>>
  readonly accountReport: Mock<(signal?: AbortSignal) => Promise<UploadedFilesReport>>
  readonly deleteFile: Mock<
    (
      fileId: string,
      isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
      signal?: AbortSignal,
    ) => Promise<void>
  >
  readonly deleteAllOurs: Mock<(signal?: AbortSignal) => Promise<void>>
  readonly post: Mock<(report: unknown, stamp?: unknown) => void>
  readonly confirmForeign: Mock<(question: string) => Promise<boolean>>
  readonly readStamped: Mock<
    (signal?: AbortSignal) => Promise<{
      report: UploadedFilesReport
      accountId: string | undefined
      generation: number
    }>
  >
  readonly deleteNotice: Mock<() => Promise<{ provider: string; count: number } | undefined>>
  readonly consumeDeleteNotice: Mock<() => Promise<{ provider: string; count: number } | undefined>>
}

/** A counting ledger double over the shared report, for port-level suites. */
export function fakeUploadedFilesLedger(report: UploadedFilesReport): FakeUploadedFilesLedger {
  return {
    read: vi.fn(() => Promise.resolve(report)),
    accountReport: vi.fn(() => Promise.resolve(report)),
    post: vi.fn(),
    deleteFile: vi.fn(() => Promise.resolve()),
    deleteAllOurs: vi.fn(() => Promise.resolve()),
    confirmForeign: vi.fn(() => Promise.resolve(false)),
    readStamped: vi.fn(() => Promise.resolve({ report, accountId: undefined, generation: 0 })),
    deleteNotice: vi.fn(() => Promise.resolve(undefined)),
    consumeDeleteNotice: vi.fn(() => Promise.resolve(undefined)),
  }
}

// Second-process driver for uploadLedgerTwoProcess.test.ts: bundled with
// esbuild and spawned as a real OS process, so it drives the REAL
// UploadLedger over shared on-disk state under the real cross-process lock.
// This file is never run as a test itself.
import { existsSync, writeFileSync } from 'node:fs'
import {
  pinOwnerForRequest,
  UploadLedger,
  type UploadLedgerDeps,
} from '../../../../src/core/media/uploadLedger'
import { fileUploadLedgerStorage } from '../../../../src/core/media/uploadLedgerStorage'

const directory = process.env['LEDGER_CHILD_DIR'] ?? ''
const accountId = process.env['LEDGER_CHILD_ACCOUNT'] ?? ''
const fileId = process.env['LEDGER_CHILD_FILE'] ?? ''
const action = process.env['LEDGER_CHILD_ACTION'] ?? ''
const readyFile = process.env['LEDGER_CHILD_READY'] ?? ''
const stopFile = process.env['LEDGER_CHILD_STOP'] ?? ''
const doneFile = process.env['LEDGER_CHILD_DONE'] ?? ''

const files: UploadLedgerDeps['files'] = {
  forAccount: () => files,
  upload: () => Promise.reject(new Error('the child never uploads')),
  retrieve: () => Promise.resolve({}),
  accountFiles: () => Promise.resolve([]),
  delete: () => Promise.resolve(),
}
const ledger = new UploadLedger({
  storage: fileUploadLedgerStorage(directory),
  files,
  accountId,
  provider: 'meta',
  poolBytes: 100_000,
  currentAccountId: () => Promise.resolve(accountId),
  now: () => Date.now(),
})
if (directory === '' || accountId === '' || fileId === '') {
  throw new Error('the child needs LEDGER_CHILD_DIR, LEDGER_CHILD_ACCOUNT and LEDGER_CHILD_FILE')
}
if (action !== 'hold' && action !== 'crash') {
  throw new Error(`unknown LEDGER_CHILD_ACTION ${action}`)
}
const owner = pinOwnerForRequest(`child-${action}`)
await ledger.pinFiles([fileId], owner)
writeFileSync(readyFile, 'ready')
if (action === 'hold') {
  // Hold the reference until the parent stops us; the parent kills us if we
  // ever outlive its test, so this loop cannot leak a process.
  const deadline = Date.now() + 30_000
  while (!existsSync(stopFile)) {
    if (Date.now() > deadline) throw new Error('the child never saw its stop file')
    await new Promise((settle) => setTimeout(settle, 20))
  }
  await ledger.unpinFiles([fileId], owner)
  writeFileSync(doneFile, 'done')
}
// A crash holder falls off the end without unpinning, like a real crash.

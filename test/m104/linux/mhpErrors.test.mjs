import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const root = path.resolve(import.meta.dirname, '../../..')
const targets = [
  'hosts/eclipse/plugin/src/io/musespark/eclipse/MhpErrors.java',
  'hosts/jetbrains/src/main/kotlin/io/github/randynorthrup/musespark/MhpErrors.kt',
]
const schemaPath = 'src/shared/hostApi/mhp-v1.1.schema.json'
const scriptPath = 'scripts/mhp-errors.mjs'
const run = (cwd, check) =>
  spawnSync(process.execPath, [scriptPath, ...(check ? ['--check'] : [])], {
    cwd,
    encoding: 'utf8',
  })

test('native error tables are current; both drift guards fire and schema changes reach both maps', async () => {
  const current = run(root, true)
  assert.equal(current.status, 0, current.stderr)
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'mhp-errors-'))
  try {
    for (const file of [scriptPath, schemaPath, ...targets]) {
      await mkdir(path.dirname(path.join(scratch, file)), { recursive: true })
      await copyFile(path.join(root, file), path.join(scratch, file))
    }
    for (const file of targets) {
      const bytes = await readFile(path.join(scratch, file), 'utf8')
      await writeFile(
        path.join(scratch, file),
        bytes.replace('PERMISSION_DENIED = -32006', 'PERMISSION_DENIED = -32603'),
      )
      const drift = run(scratch, true)
      assert.notEqual(drift.status, 0)
      assert.match(drift.stderr.replaceAll('\\', '/'), new RegExp(`MHP_ERROR_TABLE_DRIFT: ${file}`))
      await writeFile(path.join(scratch, file), bytes)
    }
    const schema = JSON.parse(await readFile(path.join(scratch, schemaPath), 'utf8'))
    const originalCodes = { ...schema.errorCodes }
    delete schema.errorCodes.unsupportedCapability
    await writeFile(path.join(scratch, schemaPath), JSON.stringify(schema))
    assert.match(run(scratch, false).stderr, /MHP_ERROR_ALIAS_UNKNOWN: unsupportedCapability/u)
    schema.errorCodes = originalCodes
    schema.errorCodes.permissionDenied = -32_099
    schema.errorCodes.futureError = -32_100
    await writeFile(path.join(scratch, schemaPath), JSON.stringify(schema))
    assert.equal(run(scratch, false).status, 0)
    assert.equal(run(scratch, true).status, 0)
    for (const file of targets) {
      const generated = await readFile(path.join(scratch, file), 'utf8')
      assert.match(generated, /PERMISSION_DENIED = -32099/u)
      assert.match(generated, /FUTURE_ERROR = -32100/u)
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

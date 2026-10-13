// Unit-level real-process proof over compiled ledger code. No provider or credential access.
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile, readFile, link, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'
import { setTimeout as delay } from 'node:timers/promises'
const root = await mkdtemp(path.join(tmpdir(), 'ledger-process-proof-'))
const workers = []
const bundle = path.join(root, 'ledger.cjs')
await build({
  stdin: {
    contents:
      "export {createSpendLedger} from './src/core/paid/spendLedger'; export {SPEND_LEDGER_ADMISSION_BOUND_MS} from './src/shared/constants'; export {withoutCredentials} from './src/runtime/credentialVariables';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const { createSpendLedger, SPEND_LEDGER_ADMISSION_BOUND_MS, withoutCredentials } = require(bundle)
const holds = []
const ledger = createSpendLedger({
  sleep: delay,
  initial: () => Promise.resolve({ settled: '0', unknownHistory: false }),
  onHold: (ms) => {
    holds.push(ms)
  },
})
const workerFile = path.join(root, 'worker.cjs')
await writeFile(
  workerFile,
  `
const {createSpendLedger} = require('./ledger.cjs');
const {setTimeout:delay} = require('node:timers/promises');
const claims = new Map();
let holdAt;
const ledger = createSpendLedger({sleep:delay,onHold:ms=>process.send({hold:ms}),initial:() => Promise.resolve({settled:'0',unknownHistory:false}),step: async (step) => {
  if(step === holdAt) { process.send({pause:step}); await new Promise(() => {}); }
}});
process.on('message',async (msg) => {
 try {
  const scope = {id:msg.scope,directory:msg.scope};
  if(msg.op === 'admit') { holdAt=msg.pause; const claim = await ledger.admit(scope,msg.bound ?? '1',msg.cap ?? '1'); claims.set(claim.id,claim); process.send({id:msg.id,admitted:true,claim:claim.id}); }
  else if(msg.op === 'settle' || msg.op === 'release') { const claim = claims.get(msg.claim); if(msg.sent) claim.markSent(); holdAt=msg.pause; const total=await claim.settle(msg.op === 'release' ? 'released' : 'settled',msg.amount ?? '0'); process.send({id:msg.id,total}); }
  else if(msg.op === 'sent') { claims.get(msg.claim).markSent(); process.send({id:msg.id,ok:true}); }
  else if(msg.op === 'read') { holdAt=msg.pause; const total=await ledger.read(scope); process.send({id:msg.id,total}); }
 } catch(e) { process.send({id:msg.id,admitted:false,kind:e.kind,message:e.message}); }
});
process.send({ready:true});
`,
)
const requests = { id: 0 }
async function start() {
  const child = fork(workerFile, [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    env: withoutCredentials(process.env),
  })
  workers.push(child)
  child.on('message', (answer) => {
    if (answer.hold !== undefined) holds.push(answer.hold)
  })
  await new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
  })
  return child
}
function call(child, msg) {
  const id = ++requests.id
  return new Promise((resolve, reject) => {
    const onMessage = (answer) => {
      if (answer.id !== id && answer.pause === undefined) return
      child.off('message', onMessage)
      child.off('exit', onExit)
      resolve(answer)
    }
    const onExit = () => {
      child.off('message', onMessage)
      reject(new Error('Worker exited before reply'))
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.send({ ...msg, id }, (error) => {
      if (error) reject(error)
    })
  })
}
async function kill(child) {
  const ended = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGKILL')
  await ended
}
async function spent(scope) {
  const total = await ledger.read({ id: scope, directory: scope })
  return total.spentUsd
}
const isStartOnly = process.argv.includes('--start-only')
const isBenchmarkOnly = process.argv.includes('--benchmark-only')
const isProofOnly = process.argv.includes('--proof-only')
const processCounts = isStartOnly || isBenchmarkOnly ? [] : [2, 6, 12]
const operations = isStartOnly || isBenchmarkOnly ? [] : ['admit', 'settle', 'release']
const ownerStates = isStartOnly || isBenchmarkOnly ? [] : [false, true]
const benchCounts = isStartOnly || isProofOnly ? [] : [10, 1000, 10_000]
try {
  const pool = []
  for (let i = 0; i < (isBenchmarkOnly ? 0 : 12); i++) pool.push(await start())
  const rounds = process.argv.includes('--quick') ? 2 : 500
  for (const n of processCounts)
    for (const k of [1, 2, 3]) {
      const expectedAdmissions = Math.min(k, n)
      const scope = path.join(root, `race-${n}-${k}`)
      const chosen = pool.slice(0, n)
      for (let round = 0; round < rounds; round++) {
        const answers = await Promise.all(
          chosen.map((child) => call(child, { op: 'admit', scope, cap: String(k) })),
        )
        const admitted = answers.filter((answer) => answer.admitted)
        assert.equal(
          admitted.length,
          expectedAdmissions,
          `round ${round}: ${k} of ${n}: ${JSON.stringify(answers)}`,
        )
        assert.equal(await spent(scope), String(expectedAdmissions))
        await Promise.all(
          answers.map((answer, i) =>
            answer.admitted
              ? call(chosen[i], { op: 'release', scope, claim: answer.claim })
              : undefined,
          ),
        )
        assert.equal(await spent(scope), '0')
      }
      process.stdout.write(`k-of-n n=${n} k=${k} rounds=${rounds} exact=true\n`)
    }
  // One continuing process completes paid requests while new processes start/stop around it.
  const scope = path.join(root, 'start-running')
  const running = pool[0]
  const startRounds = isBenchmarkOnly ? 0 : process.argv.includes('--quick') ? 2 : 200
  for (let round = 0; round < startRounds; round++) {
    const around = [await start(), await start(), await start()]
    const answers = await Promise.all([
      call(running, { op: 'admit', scope, cap: '10' }),
      ...around.map((child) => call(child, { op: 'admit', scope, cap: '10' })),
    ])
    assert.ok(
      answers.every((answer) => answer.admitted),
      JSON.stringify(answers),
    )
    await Promise.all(
      answers.map((answer, i) =>
        call([running, ...around][i], {
          op: i === 0 ? 'settle' : 'release',
          scope,
          claim: answer.claim,
          sent: i === 0,
          amount: i === 0 ? '0.01' : '0',
        }),
      ),
    )
    await Promise.all(around.map((child) => kill(child)))
  }
  if (startRounds > 0) assert.equal(await spent(scope), String(startRounds / 100))
  process.stdout.write(`start-while-running rounds=${startRounds} totals=exact\n`)
  for (const operation of operations)
    for (const step of [
      'lock',
      'transaction',
      'state',
      'audit',
      ...(operation === 'admit'
        ? ['admitted']
        : ['settlement-queued', 'receipt', 'inbox-consumed']),
    ]) {
      const child = await start()
      const scope = path.join(root, `kill-${operation}-${step}`)
      let claim
      if (operation !== 'admit') {
        const admitted = await call(child, { op: 'admit', scope, cap: '0' })
        claim = admitted.claim
        if (operation === 'settle') await call(child, { op: 'sent', scope, claim })
      }
      const paused = await call(child, {
        op: operation,
        scope,
        claim,
        cap: '0',
        amount: operation === 'settle' ? '0.4' : '0',
        pause: step,
      })
      assert.equal(paused.pause, step)
      await kill(child)
      const total = await ledger.read({ id: scope, directory: scope })
      const expected = operation === 'settle' ? (step === 'settlement-queued' ? '1' : '0.4') : '0'
      assert.equal(total.spentUsd, expected, `${operation}/${step}: ${JSON.stringify(total)}`)
      assert.equal(await spent(scope), expected)
      process.stdout.write(`kill ${operation}/${step} total=${expected} exact=true\n`)
    }
  for (const sent of ownerStates)
    for (const step of ['lock', 'transaction', 'state', 'audit', 'recovery-claim']) {
      const child = await start()
      const scope = path.join(root, `recover-${sent}-${step}`)
      const admitted = await call(child, { op: 'admit', scope, cap: '0' })
      if (sent) await call(child, { op: 'sent', scope, claim: admitted.claim })
      await kill(child)
      const recoverer = await start()
      const paused = await call(recoverer, { op: 'read', scope, pause: step })
      assert.equal(paused.pause, step)
      await kill(recoverer)
      assert.equal(await spent(scope), sent ? '1' : '0')
      assert.equal(await spent(scope), sent ? '1' : '0')
      process.stdout.write(
        `kill recovery/${step} sent=${sent} total=${sent ? '1' : '0'} exact=true\n`,
      )
    }
  for (const operation of operations) {
    const child = await start()
    const scope = path.join(root, `replay-${operation}`)
    let claim
    if (operation !== 'admit') {
      const answer = await call(child, { op: 'admit', scope, cap: '0' })
      claim = answer.claim
      if (operation === 'settle') await call(child, { op: 'sent', scope, claim })
    }
    await call(child, {
      op: operation,
      scope,
      claim,
      amount: operation === 'release' ? '0' : '0.4',
      cap: '0',
      pause: 'transaction',
    })
    await kill(child)
    const next = await start()
    const paused = await call(next, { op: 'read', scope, pause: 'recovery-transaction' })
    assert.equal(paused.pause, 'recovery-transaction', JSON.stringify(paused))
    await kill(next)
    const expected = operation === 'settle' ? '0.4' : '0'
    assert.equal(await spent(scope), expected)
    process.stdout.write(`kill recovery-transaction/${operation} total=${expected} exact=true\n`)
  }
  let benchScope = { id: 'benchmark', directory: path.join(root, 'benchmark') }
  const failedMeasurements = []
  const isHistoryFixture = process.argv.includes('--history-fixture')
  let claims = 0
  let capturedClosed
  for (const count of benchCounts) {
    if (isHistoryFixture) {
      benchScope = { id: `benchmark-${count}`, directory: path.join(root, `benchmark-${count}`) }
      claims = 0
      capturedClosed = undefined
    }
    while (claims < count) {
      if (!isHistoryFixture || claims === 0) {
        const claim = await ledger.admit(benchScope, '0.001', '0')
        await claim.settle('settled', '0.001')
        claims++
        capturedClosed = JSON.parse(
          await readFile(path.join(benchScope.directory, 'state.json'), 'utf8'),
        )
      } else {
        // History-size fixture from the real writer's complete transaction shape.
        // This measures indexing cost, not 10,000 dispatched or admitted calls.
        claims++
        const id = createHash('sha256').update(`history-fixture-${claims}`).digest('hex')
        const entry = { ...capturedClosed.change.entry, id }
        const generation = 2 * claims + 1
        const settled = String(claims / 1000)
        const receipt = createHash('sha256').update(JSON.stringify(entry)).digest('hex')
        const previous = {
          ...capturedClosed,
          generation: generation - 1,
          settled: String((claims - 1) / 1000),
          open: [{ ...entry, state: 'reserved' }],
          change: { before: generation - 2, entry: { ...entry, state: 'reserved' } },
        }
        const closed = {
          ...capturedClosed,
          generation,
          settled,
          appliedInbox: receipt,
          change: { before: generation - 1, entry },
        }
        await writeFile(
          path.join(benchScope.directory, 'audit', `${generation - 1}.json`),
          JSON.stringify(previous),
        )
        const file = path.join(benchScope.directory, 'audit', `${generation}.json`)
        await writeFile(file, JSON.stringify(closed))
        await link(file, path.join(benchScope.directory, 'history', `${id}.json`))
        capturedClosed = closed
      }
    }
    if (isHistoryFixture) {
      const staged = path.join(benchScope.directory, 'benchmark-state.json')
      await writeFile(staged, JSON.stringify(capturedClosed))
      await rename(staged, path.join(benchScope.directory, 'state.json'))
      const fixtureTotal = await ledger.read(benchScope)
      assert.equal(fixtureTotal.spentUsd, String(claims / 1000))
      process.stdout.write(
        `history-fixture records=${claims} source=real-writer-shape total=verified\n`,
      )
    }
    const samples = []
    for (let i = 0; i < 10; i++) {
      const before = performance.now()
      const claim = await ledger.admit(benchScope, '0', '0')
      samples.push(performance.now() - before)
      await claim.settle('released', '0')
    }
    const maximum = Math.max(...samples)
    if (maximum >= SPEND_LEDGER_ADMISSION_BOUND_MS)
      failedMeasurements.push(`admission ${count}: ${maximum} ms`)
    process.stdout.write(
      `admission closed=${count} max_ms=${maximum.toFixed(3)} mean_ms=${(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3)}\n`,
    )
  }
  process.stdout.write(`lock hold max_ms=${Math.max(...holds).toFixed(3)}\n`)
  assert.equal(failedMeasurements.length, 0, failedMeasurements.join('; '))
} finally {
  for (const child of workers)
    if (child.exitCode === null && child.signalCode === null) await kill(child)
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

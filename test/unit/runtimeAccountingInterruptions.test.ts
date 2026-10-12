import { fork } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, it } from 'vitest'
import { expect } from 'vitest'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { Usd } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'execprov-interruptions-'))
const stages = ['published', 'dns', 'headers', 'stream', 'settling'] as const
beforeAll(async () => {
  await build({
    stdin: {
      contents: `export * from './src/runtime/runtimeAccountingEntry'; export { pinProviderFetch } from './src/runtime/exec/providerExec'; export { createRunLedger } from './src/runtime/exec/runLedger'; export { ModelApiClient } from './src/core/backends/modelapi/client'; export { FAKE_MODEL_API_KEY, fakeModelApi, fakeModelApiClient, fakeModelApiClientSettings } from './test/unit/helpers/fakeModelApi'; export { createConfiguredProviderServices } from './src/core/providers/configured';`,
      resolveDir: process.cwd(),
    },
    outfile: path.join(root, 'engine.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  writeFileSync(
    path.join(root, 'child.cjs'),
    String.raw`
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const [folder, stage, mode] = process.argv.slice(2);
const note = (line) => { try { fssync.appendFileSync(folder + '/child.log', line + '\n'); } catch {} };
note('argv ' + JSON.stringify(process.argv.slice(2)));
const controller = new AbortController();
let unblock, pending, paused = false, renames = 0;
const gate = () => {
  if (paused) return Promise.resolve();
  paused = true;
  pending = new Promise((resolve, reject) => {
    unblock = reject;
    controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), {once:true});
    process.send({stage, totals: ledger.totals()});
  });
  return pending;
};
const rename = fs.rename;
fs.rename = async (from, to) => {
  const claim = String(to).replaceAll('\\', '/').endsWith('/claim.json');
  if (claim && ++renames === 2 && stage === 'settling') await gate();
  await rename(from, to);
  if (claim && renames === 1 && stage === 'published') await gate();
};
const {createRuntimeDailyBudget, withRuntimeAccounting, createRunLedger, ModelApiClient, FAKE_MODEL_API_KEY, fakeModelApi, fakeModelApiClient, fakeModelApiClientSettings, pinProviderFetch, createConfiguredProviderServices} = require('./engine.cjs');
const log = {trace(){}, info(){}, warn(){}, error(){}};
const ledger = createRunLedger({capUsd:'5', maxRequests:2});
const daily = createRuntimeDailyBudget({dataFolder:folder, now:Date.now, sleep:() => Promise.resolve()});
const dispatch = {};
const api = fakeModelApi();
api.script({text:'captured fake answer', ...(stage === 'headers' ? {hold: new Promise((resolve, reject) => { process.on('headers', () => {gate().then(resolve,reject)}); })} : {}), ...(stage === 'stream' ? {holdEof: new Promise((resolve,reject) => {process.on('stream', () => {gate().then(resolve,reject)});}), onEofHeld: () => process.emit('stream')} : {})});
let base;
if (mode === 'configured') {
  fssync.writeFileSync(folder + '/config.json', JSON.stringify({v:1, defaultModel:'local/m', providers:[{id:'local', preset:'custom', format:'responses', address:'http://127.0.0.1:17999', auth:'apiKey', models:['m'], modelLimits:{m:{contextTokens:128000, outputTokens:4096}}, prices:{m:{input:0.001, output:0.001}}}]}));
  fssync.writeFileSync(folder + '/catalog.json', JSON.stringify({providers:{}}));
  const services = createConfiguredProviderServices(fakeModelApiClient(api, log), {configFile:folder + '/config.json', catalogFile:folder + '/catalog.json', secrets:{get:async () => JSON.stringify({v:1, auth:'apiKey', origin:'http://127.0.0.1:17999', secret:FAKE_MODEL_API_KEY})}, resolve:async () => {note('resolve called'); if(stage === 'dns') await gate(); return ['127.0.0.1'];}, send:async (target, body, headers, signal) => {// Production pins this fetch (providerExec): dispatch runs just before sending.
dispatch.onRequestStarted?.(); const pending = api.fetch(target.url.href, {method:'POST', headers:{...headers, authorization:'Bearer ' + FAKE_MODEL_API_KEY}, body, signal}); if(stage === 'headers') process.emit('headers'); const response = await pending; note('send ' + String(response.status) + ' ' + target.url.href); const bytes = Buffer.from(await response.arrayBuffer()); return {status:response.status, headers:{}, body:(async function*(){ yield new Uint8Array(bytes); })(), close:() => {}};}});
  base = services.client;
} else {
  const provider = {entry:{id:'local'}, preset:{id:'custom'}, origin:'http://127.0.0.1:17999', network:'local', request:{rule:{kind:'exact',path:'/responses'},source:'research'}};
  const pinned = pinProviderFetch((url, init) => {const response = api.fetch(url, init); if(stage === 'headers') process.emit('headers'); return response;}, provider, [provider.request.rule], async () => {if(stage === 'dns') await gate(); return ['127.0.0.1'];}, () => dispatch.onRequestStarted?.());
  base = new ModelApiClient({...fakeModelApiClientSettings(log), baseUrl:provider.origin, fetch:pinned});
}
const client = withRuntimeAccounting(base, daily, {ledger, refuse(){}, started(){}, settled(){}}, dispatch);
process.on('message', async ({action}) => {
  if (action === 'cancel') controller.abort();
  else if (action === 'failure') unblock(new Error('synthetic transport interruption'));
  else if (action === 'start') {
    try { await Array.fromAsync(client.streamResponse({model:mode === 'configured' ? 'local/m' : 'muse-spark-1.3',instructions:'Test',input:[{type:'message',role:'user',content:[{type:'input_text',text:'hello'}]}],tools:[],tool_choice:'auto',stream:true,store:false,prompt_cache_key:'test',prompt_cache_retention:'in_memory',max_output_tokens:64,reasoning:{effort:'minimal'},include:[]}, controller.signal)); } catch (error) { note('stream threw: ' + String(error && error.message ? error.message : error)); }
    process.send({done:true, totals:ledger.totals()});
    process.disconnect();
  }
});
process.send({ready:true});
`,
  )
})
afterAll(async () => {
  await removeFolder(root)
})
const messageSchema = z.object({
  ready: z.optional(z.boolean()),
  stage: z.optional(z.enum(stages)),
  done: z.optional(z.boolean()),
  totals: z.optional(
    z.looseObject({ reservedUsd: z.string(), uncertainUsd: z.string(), requests: z.number() }),
  ),
})
const claimSchema = z.object({
  claimId: z.string(),
  reservedUsd: z.string(),
  settledUsd: z.optional(z.string()),
  hasUnknownCost: z.optional(z.boolean()),
})
for (const stage of stages) {
  // The services path never consults options.resolve for IP literals
  // (verifyEndpoint skips DNS for IPs); DNS gating lives in pinProviderFetch,
  // which the meta mode covers. The journal mechanics are identical.
  const modes = stage === 'dns' ? (['meta'] as const) : (['meta', 'configured'] as const)
  for (const mode of modes) {
    it.each(['kill', 'cancel', 'failure'])(
      `closes real daily/run claims after ${stage} via ${mode}: %s`,
      async (action) => {
        const data = path.join(root, `${stage}-${mode}-${action}`)
        mkdirSync(data)
        writeFileSync(path.join(data, 'settings.json'), '{"paidDailyBudgetUsd":5}')
        const child = fork(path.join(root, 'child.cjs'), [data, stage, mode], {
          env: withoutCredentials(process.env),
          silent: true,
        })
        const reached = Promise.withResolvers<undefined>()
        const finished = Promise.withResolvers<z.infer<typeof messageSchema>>()
        const exited = Promise.withResolvers<undefined>()
        const childErrors: string[] = []
        child.stderr?.on('data', (chunk) => {
          childErrors.push(String(chunk))
        })
        child.on('error', (error) => {
          reached.reject(error)
          finished.reject(error)
          exited.reject(error)
        })
        child.on('exit', () => {
          exited.resolve(undefined)
          if (!child.killed)
            reached.reject(
              new Error(
                `child exited before stage${childErrors.length === 0 ? '' : `: ${childErrors.join('')}`}`,
              ),
            )
        })
        child.on('message', (raw: unknown) => {
          const message = messageSchema.parse(raw)
          if (message.ready) child.send({ action: 'start' })
          if (message.stage) reached.resolve(undefined)
          if (message.done) finished.resolve(message)
        })
        try {
          await reached.promise
          if (action === 'kill') {
            child.kill('SIGKILL')
          } else {
            child.send({ action })
            const final = await finished.promise
            expect(final.totals?.reservedUsd).toBe('0')
            if (stage === 'published' || stage === 'dns') {
              expect(final.totals?.requests).toBe(0)
              expect(final.totals?.uncertainUsd).toBe('0')
            }
          }
          await exited.promise
          // A real next-start admission proves dead-owner recovery (ESRCH),
          // without releasing sent uncertainty. Its own claim id is filtered
          // out of the assertions below.
          const daily = createRuntimeDailyBudget({
            dataFolder: data,
            now: Date.now,
            sleep: () => Promise.resolve(),
          })
          let nextClaimId: string | undefined
          try {
            const next = await daily.reserve(
              Usd.from(0.000001).toAmount(),
              new AbortController().signal,
            )
            nextClaimId = next.claimId
            await next.settle(Usd.from(0).toAmount())
          } catch {
            /* Sent uncertainty may legitimately exhaust the daily scope. */
          }
          const journal = path.join(data, 'paid-daily')
          const rows = readdirSync(journal, { recursive: true })
            .filter((name) => String(name).replaceAll('\\', '/').endsWith('/claim.json'))
            .map((name) =>
              claimSchema.parse(JSON.parse(readFileSync(path.join(journal, String(name)), 'utf8'))),
            )
          // A kill before the first publish may leave no interrupted row at
          // all; the next-start row always exists unless the scope is spent.
          expect(rows.length).toBeGreaterThan(0)
          const claims = rows.filter((claim) => claim.claimId !== nextClaimId)
          // A kill stops the only attempt, so a sent stage leaves exactly its
          // one interrupted row, asserted strictly. Cancel/failure may retry
          // into priced rows or a refused row; those must prove the
          // interruption liability exists and no row refunds or vanishes.
          const isSentStage = stage !== 'published' && stage !== 'dns'
          if (action === 'kill' && isSentStage) expect(claims.length).toBe(1)
          // Headers/stream never complete the response, so usage stays unknown
          // and at least one row must hold the full reservation. At settling
          // time usage is already known, so the row keeps its actual cost.
          if (action !== 'kill' && (stage === 'headers' || stage === 'stream'))
            expect(
              claims.some(
                (claim) => claim.hasUnknownCost === true && claim.settledUsd === claim.reservedUsd,
              ),
            ).toBe(true)
          for (const claim of claims) {
            expect(claim.settledUsd).toBeDefined()
            if (!isSentStage) {
              expect(claim.settledUsd).toBe('0')
              expect(claim.hasUnknownCost).toBe(false)
            } else if (action === 'kill') {
              // P2-2: a sent request with unknown usage is closed durably at
              // its full reserved amount with hasUnknownCost, never refunded.
              expect(claim.hasUnknownCost).toBe(true)
              expect(claim.settledUsd).toBe(claim.reservedUsd)
            } else {
              const isHeldReservation =
                claim.hasUnknownCost === true && claim.settledUsd === claim.reservedUsd
              const isPricedActual =
                claim.hasUnknownCost === false &&
                claim.settledUsd !== '0' &&
                claim.settledUsd !== claim.reservedUsd
              const isUnsentOrRefused = claim.hasUnknownCost === false && claim.settledUsd === '0'
              expect(isHeldReservation || isPricedActual || isUnsentOrRefused).toBe(true)
            }
          }
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
          await exited.promise
        }
      },
    )
  }
}

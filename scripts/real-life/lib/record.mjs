// The record of a run: what was used, on what, and per scenario and route
// what was observed, with the requests, the dollars and the seconds. It is
// the release's record, read by a person: no gate reads it (there is no
// scripts/check-claims.mjs). Its fields are `artefact`, `os`, `startedAt`,
// `endedAt` and `results`, each result with `scenario`, `claims`, `route`,
// `model`, `surface`, `outcome`, `observed`, `requests`, `usd` and
// `seconds`; what the run adds for a person stands beside those.
// `usd` is usage a provider reported, at the model's price; `uncertainUsd`
// is what the product booked for a request that ended with no usage report.
// No key, no home folder and no user name is in it: everything written
// passes through one scrub.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { usdText } from './budget.mjs'

const CLIP = 300
const LOG_LINES = 12

/**
 * A function that takes what must not be shown out of a text: each secret
 * by a fixed word, each private folder by its role.
 * @param {ReadonlyMap<string, string>} replacements text to its stand-in
 */
export function scrubber(replacements) {
  const pairs = [...replacements]
    .filter(([text]) => text.length > 2)
    .toSorted((a, b) => b[0].length - a[0].length)
  return (text) => {
    let cleaned = String(text)
    for (const [secret, standIn] of pairs) {
      // Windows paths are also written with the other slash, and JSON doubles it.
      const spellings = [secret, secret.replaceAll('\\', '/'), secret.replaceAll('\\', '\\\\')]
      for (const spelling of spellings) cleaned = cleaned.replaceAll(spelling, () => standIn)
    }
    return cleaned
  }
}

/**
 * What `usage --json` printed, read fail-closed: a failed command, an
 * output that is no JSON, or a shape with no records array is spend nobody
 * knows, never an empty reading.
 * @param {{ code: number | null, stdout: string }} run the finished command
 * @returns {{ ok: true, records: object[] } | { ok: false, reason: string }}
 */
export function parseUsageOutput(run) {
  if (run.code !== 0) return { ok: false, reason: `usage ended with exit ${String(run.code)}` }
  let printed
  try {
    printed = JSON.parse(run.stdout)
  } catch {
    return { ok: false, reason: 'usage printed no JSON' }
  }
  return Array.isArray(printed?.records)
    ? { ok: true, records: printed.records }
    : { ok: false, reason: 'usage printed no records array' }
}

/** A short form of what was seen, on one line. */
export const clip = (text) => {
  const line = String(text ?? '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  return line.length > CLIP ? `${line.slice(0, CLIP)}…` : line
}

/** The last lines of the product's own log, for a scenario that failed. */
export const logExcerpt = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-LOG_LINES)

/** What was seen, as the one sentence the gate keeps: each observation, the missing ones named so. */
export const observedText = (seen) =>
  seen.map((one) => `${one.ok ? 'saw' : 'MISSING'} ${one.what}: ${one.saw}`).join(' | ') ||
  'nothing was observed'

/** The route as the claims table names it; the vendor goes with the model. */
export const tableRoute = (route) => {
  if (route.kind === 'provider') return 'provider'
  return route.kind === 'meta' ? 'modelapi' : 'musecode'
}

const isBooked = (usd) => /[1-9]/u.test(usd ?? '')

const line = (result) =>
  `${result.outcome === 'pass' ? 'PASS' : 'FAIL'}  ${result.scenario} · ${result.vendor} · ${result.model} · ${result.surface} · ${String(result.requests)} req · $${result.usd}${isBooked(result.uncertainUsd) ? ` (+$${result.uncertainUsd} booked with no usage)` : ''} · ${result.seconds.toFixed(1)} s`

/** The plain-text summary of a record. */
export function summaryOf(record) {
  const lines = [
    `Real-life run of ${record.artefact.name} (${record.artefact.package} ${record.artefact.version})`,
    `SHA-256 ${record.artefact.sha256}`,
    `${record.os}, Node ${record.node}; ${record.startedAt} to ${record.endedAt}`,
    `Caps: ${String(record.caps.requests)} requests, $${record.caps.usd} of reported usage. Made: ${String(record.totals.requests)} requests, $${record.totals.usd} of usage the providers reported (settled).`,
    `Booked by the product for requests that were sent and came back with no usage report: $${record.totals.uncertainUsd} (may be real money). Its daily ledger holds $${record.totals.ledgerUnsettled.usd} in ${String(record.totals.ledgerUnsettled.claims)} claim(s) with no settlement (a whole reservation each). Runs the product turned away before anything was sent, at the run's own asking: ${String(record.totals.turnedAwayUnsentRuns)}.`,
    `The product's own usage for this home afterwards: ${String(record.totals.productUsage.requests)} requests, $${record.totals.productUsage.usd}${record.totals.productUsage.unread === undefined ? '' : ` (could not be read: ${record.totals.productUsage.unread})`}.`,
    ...record.settings.map(
      (one) => `Set by the run in ${one.where}: ${one.setting} = ${String(one.value)}; ${one.why}.`,
    ),
    ...(record.earlierRun === undefined
      ? []
      : [
          `AN EARLIER RUN noted at ${record.earlierRun.storedAt} that it stored a Meta key and did not remove it. A Meta key is ${record.earlierRun.stillStored ? 'STILL IN THE CREDENTIAL STORE' : 'no longer stored'}. This run ${record.earlierRun.did}.`,
        ]),
    ...(record.entriesFoundAtStart === undefined
      ? []
      : [
          `LEFT IN THE CREDENTIAL STORE by an earlier run or diagnostic, found when this run started: ${record.entriesFoundAtStart.join(', ')}. This run never removes or replaces a stored key: a route whose name is taken is not run; remove it with the product: \`auth clear --provider <name>\`.`,
        ]),
    `Scenario runs: ${String(record.totals.passed)} passed, ${String(record.totals.failed)} failed, ${String(record.totals.notRun)} not run.`,
    '',
  ]
  for (const route of record.routes) {
    lines.push(`Route ${route.id} (${route.wire}, ${route.model}): ${route.state}`)
  }
  lines.push('')
  for (const result of record.results) {
    lines.push(line(result), `      ${result.title} [${result.claims.join(', ')}]`)
    for (const seen of result.seen) {
      lines.push(`      ${seen.ok ? 'saw    ' : 'MISSING'} ${seen.what}: ${seen.saw}`)
    }
    const left = result.stepsNotRun ?? []
    for (const step of left) lines.push(`      not run ${step.what}: ${step.why}`)
    const logged = result.log ?? []
    for (const text of logged) lines.push(`      | ${text}`)
  }
  if (record.notRun.length > 0) lines.push('', 'Not run:')
  for (const skipped of record.notRun) {
    lines.push(
      `      ${skipped.scenario} · ${skipped.vendor} · ${skipped.model} · ${skipped.surface}: ${skipped.reason}`,
    )
  }
  if (record.keysLeftInTheCredentialStore.length > 0) {
    lines.push(
      '',
      `STILL IN THE CREDENTIAL STORE: ${record.keysLeftInTheCredentialStore.join(', ')}`,
    )
  }
  return `${lines.join('\n')}\n`
}

/**
 * The totals of a run. `usd` is settled (usage the providers reported).
 * `uncertainUsd` is what the product booked for requests that were sent
 * and came back with no usage. `ledgerUnsettled` is what its daily ledger
 * holds with no settlement: a whole reservation for each such request (more
 * than it booked for a request an editor session stopped), and for a run
 * turned away for its budget on a provider's route. `turnedAwayUnsentRuns`
 * counts the refusals the run itself asked for (lib/admission.mjs).
 * @param {{ claims: number, micro: number, unread: string[] }} unsettled lib/ledger.mjs
 */
export function totalsOf(results, notRun, spent, productUsage, unsettled) {
  return {
    passed: results.filter((result) => result.outcome === 'pass').length,
    failed: results.filter((result) => result.outcome === 'fail').length,
    notRun: notRun.length,
    requests: spent.requests,
    usd: usdText(spent.micro),
    uncertainUsd: usdText(spent.uncertain),
    turnedAwayUnsentRuns: spent.turnedAway,
    ledgerUnsettled: {
      claims: unsettled.claims,
      usd: usdText(unsettled.micro),
      ...(unsettled.unread.length > 0 && { unread: unsettled.unread }),
    },
    productUsage,
  }
}

/**
 * Makes the folder a record is written in, so a run that cannot write its
 * record stops before anything is spent, not after paid calls.
 * @param {string} file the record file (`<file>.json` and `<file>.txt`)
 */
export function ensureRecordDir(file) {
  mkdirSync(path.dirname(file), { recursive: true })
}

/** Writes `<file>.json` and `<file>.txt`, everything through the scrub. */
export function writeRecord(file, record, scrub) {
  ensureRecordDir(file)
  const stem = file.replace(/\.(json|txt)$/u, '')
  const cleaned = JSON.parse(scrub(JSON.stringify(record)))
  writeFileSync(`${stem}.json`, `${JSON.stringify(cleaned, null, 2)}\n`)
  writeFileSync(`${stem}.txt`, summaryOf(cleaned))
  return { json: `${stem}.json`, text: `${stem}.txt` }
}

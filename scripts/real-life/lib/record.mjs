// The record of a run: what was used, on what, and per scenario and route
// what was observed, with the requests, the dollars and the seconds. It is
// the file the claims gate reads (scripts/check-claims.mjs: `artefact`,
// `os`, `startedAt`, `endedAt` and `results`, each result with `scenario`,
// `claims`, `route`, `model`, `surface`, `outcome`, `observed`, `requests`,
// `usd` and `seconds`); what the run adds for a person stands beside those.
// No key, no home folder and no user name is in it: everything written
// passes through one scrub.
import { writeFileSync } from 'node:fs'
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

const line = (result) =>
  `${result.outcome === 'pass' ? 'PASS' : 'FAIL'}  ${result.scenario} · ${result.vendor} · ${result.surface} · ${String(result.requests)} req · $${result.usd} · ${result.seconds.toFixed(1)} s`

/** The plain-text summary of a record. */
export function summaryOf(record) {
  const lines = [
    `Real-life run of ${record.artefact.name} (${record.artefact.package} ${record.artefact.version})`,
    `SHA-256 ${record.artefact.sha256}`,
    `${record.os}, Node ${record.node}; ${record.startedAt} to ${record.endedAt}`,
    `Caps: ${String(record.caps.requests)} requests, $${record.caps.usd}. Made: ${String(record.totals.requests)} requests, $${record.totals.usd} by the product's own count.`,
    `The product's own usage for this home afterwards: ${String(record.totals.productUsage.requests)} requests, $${record.totals.productUsage.usd}.`,
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
    const logged = result.log ?? []
    for (const text of logged) lines.push(`      | ${text}`)
  }
  if (record.notRun.length > 0) lines.push('', 'Not run:')
  for (const skipped of record.notRun) {
    lines.push(
      `      ${skipped.scenario} · ${skipped.vendor} · ${skipped.surface}: ${skipped.reason}`,
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

/** The totals of a run. */
export function totalsOf(results, notRun, spent, productUsage) {
  return {
    passed: results.filter((result) => result.outcome === 'pass').length,
    failed: results.filter((result) => result.outcome === 'fail').length,
    notRun: notRun.length,
    requests: spent.requests,
    usd: usdText(spent.micro),
    productUsage,
  }
}

/** Writes `<file>.json` and `<file>.txt`, everything through the scrub. */
export function writeRecord(file, record, scrub) {
  const stem = file.replace(/\.(json|txt)$/u, '')
  const cleaned = JSON.parse(scrub(JSON.stringify(record)))
  writeFileSync(`${stem}.json`, `${JSON.stringify(cleaned, null, 2)}\n`)
  writeFileSync(`${stem}.txt`, summaryOf(cleaned))
  return { json: `${stem}.json`, text: `${stem}.txt` }
}

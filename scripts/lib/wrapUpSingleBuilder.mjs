// The wrap-up single-builder rule (tool rounds, round 7): `wrapUpLimit` is
// written in exactly one place, `enterWrapUpPhase`, and every request build
// (`streamAttempt`: first attempts, HTTP retries, whole-stream retries,
// media recovery, overflow recovery) calls it. `body()` only reads the
// phase. Logic only: no main-module comparison (see check-wrap-up-request.mjs).

import { readFileSync } from 'node:fs'

function methodSpan(source, startMarker) {
  const start = source.indexOf(startMarker)
  if (start === -1) return
  // Skip the parameter list first: an object-typed parameter carries its
  // own braces, and the body brace is the first one past the params.
  const paramsOpen = source.indexOf('(', start)
  if (paramsOpen === -1) return
  let parens = 0
  let paramsEnd = -1
  for (let at = paramsOpen; at < source.length; at += 1) {
    if (source[at] === '(') parens += 1
    else if (source[at] === ')') {
      parens -= 1
      if (parens === 0) {
        paramsEnd = at
        break
      }
    }
  }
  if (paramsEnd === -1) return
  const open = source.indexOf('{', paramsEnd)
  if (open === -1) return
  let depth = 0
  let offset = 0
  for (const char of source.slice(open)) {
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        const end = open + offset + 1
        return {
          text: source.slice(start, end),
          startLine: source.slice(0, start).split('\n').length,
        }
      }
    }
    offset += 1
  }
  return
}

function assignmentsOf(spanText, spanStartLine) {
  const lines = []
  for (const [index, line] of spanText.split('\n').entries()) {
    // A write, not a read: `.wrapUpLimit =`, never `===`, `!==`, `?:` or `?`.
    if (/\.wrapUpLimit\s*=(?![=>])/.test(line)) lines.push(spanStartLine + index)
  }
  return lines
}

/**
Check the single-builder rule over one source file (ModelApiHost.ts).
Fails on missing, empty or unreadable input: no input is never a pass.
Returns `{ ok: true }` or `{ ok: false, problem }`.
*/
export function checkWrapUpSingleBuilder(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { ok: false, problem: 'wrap-up request guard: pass the ModelApiHost.ts path to check' }
  }
  let source
  try {
    source = readFileSync(filePath, 'utf8')
  } catch {
    return { ok: false, problem: `wrap-up request guard: cannot read ${filePath}` }
  }
  if (source.length > 0) {
    const writer = methodSpan(source, 'private enterWrapUpPhase(')
    if (writer === undefined) {
      return {
        ok: false,
        problem: `wrap-up request guard: enterWrapUpPhase not found in ${filePath}`,
      }
    }
    const builder = methodSpan(source, 'private async streamAttempt(')
    if (builder === undefined) {
      return { ok: false, problem: `wrap-up request guard: streamAttempt not found in ${filePath}` }
    }
    const body = methodSpan(source, 'private body(')
    if (body === undefined) {
      return { ok: false, problem: `wrap-up request guard: body() not found in ${filePath}` }
    }
    // Every write in the file, by line: exactly one, inside the writer.
    const writes = assignmentsOf(source, 1)
    if (writes.length !== 1) {
      return {
        ok: false,
        problem: `wrap-up request guard: expected exactly one wrapUpLimit write, found ${String(writes.length)} in ${filePath}`,
      }
    }
    const [writeLine] = writes
    const writerLines = new Set(assignmentsOf(writer.text, writer.startLine))
    if (!writerLines.has(writeLine)) {
      return {
        ok: false,
        problem: `wrap-up request guard: wrapUpLimit written outside enterWrapUpPhase at ${filePath}:${String(writeLine)}`,
      }
    }
    // Every send path builds through streamAttempt, so it must decide the phase.
    if (!builder.text.includes('this.enterWrapUpPhase(')) {
      return {
        ok: false,
        problem: `wrap-up request guard: streamAttempt never calls enterWrapUpPhase in ${filePath}`,
      }
    }
    // The reader must stay a reader: no write inside body().
    if (assignmentsOf(body.text, body.startLine).length > 0) {
      return {
        ok: false,
        problem: `wrap-up request guard: body() writes wrapUpLimit in ${filePath}`,
      }
    }
    return { ok: true }
  }
  return { ok: false, problem: `wrap-up request guard: empty input ${filePath}` }
}

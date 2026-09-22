#!/usr/bin/env node
// Render cost of the assistant markdown at streaming sizes. Each `item/delta`
// re-renders the reply, so two numbers matter: the render time of a whole
// reply at its final length (what a naive renderer pays per delta near the
// end of a 10k-token answer) and the render time of the streaming tail that
// `splitForStreaming` isolates (what the transcript actually re-parses per
// delta). Not a gate; the numbers go into the M4 certification.
//
//   node scripts/measure-markdown.mjs        (bundles from source with esbuild;
//                                             the scratch entry lives under
//                                             the gitignored harness-shots/)

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const CHARS_PER_TOKEN = 4
const TOKEN_SIZES = [2500, 5000, 10_000]
const RUNS = 5

const PARAGRAPH =
  'The reducer folds `item/delta` events into the open entry, so **streaming** text costs one array copy per delta; a 10k-token reply is about 40k characters.\n\n'
const CODE =
  '```ts\nexport function fold(state: State, delta: string): State {\n  return { ...state, text: state.text + delta }\n}\n```\n\n'

function replyOf(tokens) {
  const unit = PARAGRAPH + CODE
  return unit.repeat(Math.ceil((tokens * CHARS_PER_TOKEN) / unit.length))
}

// Inside the repository so esbuild resolves node_modules from here.
const dir = path.resolve('harness-shots', 'measure')
await mkdir(dir, { recursive: true })
const entry = path.join(dir, 'entry.mjs')
await writeFile(
  entry,
  `import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MarkdownView } from '../../src/webview/components/MarkdownView.tsx'
export { splitForStreaming } from '../../src/webview/streamSplit.ts'
export function render(text) {
  return renderToString(createElement(MarkdownView, { text, onOpenLink() {}, onCopy() {}, onInsert() {} }))
}
`,
)
const outfile = path.join(dir, 'bundle.mjs')
await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  // Only the source is bundled; react and the markdown stack load from
  // node_modules at run time (an ESM bundle of react-dom/server would need
  // CommonJS `require`).
  packages: 'external',
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  logLevel: 'silent',
})
const { render, splitForStreaming } = await import(pathToFileURL(outfile).href)

function timed(text) {
  render(text) // warm up
  const times = []
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now()
    render(text)
    times.push(performance.now() - started)
  }
  times.sort((a, b) => a - b)
  return { median: times[Math.floor(times.length / 2)], max: times.at(-1) }
}

console.log(
  [
    'tokens',
    'chars',
    'whole median ms',
    'whole max ms',
    'tail chars',
    'tail median ms',
    'tail max ms',
  ].join('\t'),
)
for (const tokens of TOKEN_SIZES) {
  const text = replyOf(tokens)
  const whole = timed(text)
  // What a delta near the end of the reply re-renders while streaming.
  const { tail } = splitForStreaming(text)
  const streaming = timed(tail)
  console.log(
    [
      String(tokens),
      String(text.length),
      whole.median.toFixed(1),
      whole.max.toFixed(1),
      String(tail.length),
      streaming.median.toFixed(1),
      streaming.max.toFixed(1),
    ].join('\t'),
  )
}
await rm(dir, { recursive: true, force: true })

// Web fetch's page converter as it ships (M69, PLAN.md D49): the build's
// dist/pageWorker.js, beside dist/extension.js, started as a worker thread
// from VS Code's extension host, converts a page. The unit tests build the
// worker themselves and run it on plain Node; this proves the shipped
// bundle loads and runs where the extension does.

import * as assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import * as vscode from 'vscode'
import { pageConverter } from '../../src/host/web/pageConverter'
import type { Logger } from '../../src/host/logger'
import { EXTENSION_QUALIFIED_ID, PAGE_WORKER_FILE } from '../../src/shared/constants'

suite("web fetch's page converter bundle (M69)", () => {
  test('converts a page on a worker from the installed extension', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, `extension ${EXTENSION_QUALIFIED_ID} not found`)
    const warnings: string[] = []
    const log: Logger = {
      trace: () => undefined,
      info: () => undefined,
      warn: (message) => {
        warnings.push(message)
      },
      error: (message) => {
        warnings.push(message)
      },
    }
    const convert = pageConverter(
      vscode.Uri.joinPath(extension.extensionUri, 'dist', PAGE_WORKER_FILE).fsPath,
      log,
    )
    const html =
      '<meta charset="windows-1252"><title>Guide</title><base href="https://cdn.example.org/d/">' +
      '<script>not text</script><p hidden>Served</p><p>Caf\u{E9} <a href="x">link</a></p>'
    const outcome = await convert(
      {
        bytes: new Uint8Array(Buffer.from(html, 'latin1')),
        charset: undefined,
        url: 'https://docs.example.com/',
        maxChars: 100_000,
      },
      new AbortController().signal,
    )
    assert.deepEqual(outcome, {
      ok: true,
      page: {
        title: 'Guide',
        // A script is never page text; a hidden paragraph is text as served.
        markdown: 'Served\n\nCafé [link](https://cdn.example.org/d/x)',
        isTruncated: false,
      },
    })
    assert.deepEqual(warnings, [])
  })
})

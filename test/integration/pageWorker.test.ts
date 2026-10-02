// Web fetch's page converter as it ships (M69, PLAN.md D49): the build's
// dist/pageWorker.js, beside dist/extension.js, started as a worker thread
// from VS Code's extension host, converts a page. The unit tests build the
// worker themselves and run it on plain Node; this proves the shipped
// bundle loads and runs where the extension does, on the newest VS Code and
// on the oldest the manifest accepts (Node 20.18.3 in 1.99). There
// html-encoding-sniffer 7's `engines` field (Node 22.13) does not reach:
// bundled, it needs only what Node 20.18 has (PR #60).

import * as assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import * as vscode from 'vscode'
import { pageConverter } from '../../src/host/web/pageConverter'
import type { HtmlConverter } from '../../src/core/web/htmlConversion'
import type { Logger } from '../../src/host/logger'
import { EXTENSION_QUALIFIED_ID, PAGE_WORKER_FILE } from '../../src/shared/constants'

const PAGE_URL = 'https://docs.example.com/'
const MAX_CHARS = 100_000
// The prescan reads the first 1,024 bytes for a `<meta>`; past them only a later
// `<meta>` the parser meets, or a header, changes what is read.
const PAST_THE_PRESCAN = 1100

interface Started {
  readonly convert: HtmlConverter
  readonly warnings: string[]
}

function startConverter(): Started {
  const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
  assert.ok(extension, `extension ${EXTENSION_QUALIFIED_ID} not found`)
  const warnings: string[] = []
  const keep = (message: string): void => {
    warnings.push(message)
  }
  const log: Logger = { trace: () => undefined, info: () => undefined, warn: keep, error: keep }
  const convert = pageConverter(
    vscode.Uri.joinPath(extension.extensionUri, 'dist', PAGE_WORKER_FILE).fsPath,
    log,
  )
  return { convert, warnings }
}

function bytesOf(...parts: readonly (string | readonly number[])[]): Uint8Array {
  return new Uint8Array(
    Buffer.concat(
      parts.map((part) =>
        typeof part === 'string' ? Buffer.from(part, 'utf8') : Buffer.from(part),
      ),
    ),
  )
}

const XML_DECLARATION = '<?xml version="1.0" encoding="windows-1252"?>'
const UTF_16_PAGE = '<?xml version="1.0"?><meta charset="windows-1252"><p>Caf\u{E9}</p>'
const UTF_16_BE_PAGE = Buffer.from(Buffer.from(UTF_16_PAGE, 'utf16le')).swap16()
const LATE_META_PAGE = bytesOf(
  XML_DECLARATION,
  `<p>${'x'.repeat(PAST_THE_PRESCAN)}</p><meta charset="iso-8859-2"><p>`,
  [0xb1],
)

interface Golden {
  readonly name: string
  readonly bytes: Uint8Array
  readonly charset: string | undefined
  readonly markdown: string
}

// Each expected text is what the Encoding standard's tables give for the bytes.
const GOLDENS: readonly Golden[] = [
  {
    // 82 B1 82 F1 82 C9 82 BF 82 CD is "こんにちは" in Shift_JIS.
    name: 'a Shift_JIS page its <meta> declares',
    bytes: bytesOf(
      '<meta charset="Shift_JIS"><p>',
      [0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd],
    ),
    charset: undefined,
    markdown: '\u{3053}\u{3093}\u{306B}\u{3061}\u{306F}',
  },
  {
    // D6 D0 CE C4 is "中文" in GBK.
    name: 'a GBK page the header declares',
    bytes: bytesOf('<p>', [0xd6, 0xd0, 0xce, 0xc4]),
    charset: 'gbk',
    markdown: '\u{4E2D}\u{6587}',
  },
  {
    name: 'a UTF-8 byte order mark over a conflicting header and <meta>',
    bytes: bytesOf([0xef, 0xbb, 0xbf], '<meta charset="iso-8859-2"><p>Caf\u{E9}'),
    charset: 'windows-1252',
    markdown: 'Caf\u{E9}',
  },
  {
    name: 'a UTF-16 page without a byte order mark, told by its XML signature',
    bytes: new Uint8Array(Buffer.from(UTF_16_PAGE, 'utf16le')),
    charset: undefined,
    markdown: 'Caf\u{E9}',
  },
  {
    name: 'a big-endian UTF-16 page without a byte order mark',
    bytes: new Uint8Array(UTF_16_BE_PAGE),
    charset: undefined,
    markdown: 'Caf\u{E9}',
  },
  {
    name: "an XML declaration as a page's only declaration",
    bytes: bytesOf(XML_DECLARATION, '<p>', [0xe9]),
    charset: undefined,
    markdown: '\u{E9}',
  },
  {
    // B1 is "ą" in ISO-8859-2: the <meta> met past the prescan changes the tentative encoding.
    name: 'a <meta> met after the prescan, which changes a tentative encoding',
    bytes: LATE_META_PAGE,
    charset: undefined,
    markdown: `${'x'.repeat(PAST_THE_PRESCAN)}\n\n\u{105}`,
  },
  {
    // B1 is "±" in windows-1252: the header is certain, so the late <meta> changes nothing.
    name: 'the same page under a header, which a late <meta> does not change',
    bytes: LATE_META_PAGE,
    charset: 'windows-1252',
    markdown: `${'x'.repeat(PAST_THE_PRESCAN)}\n\n\u{B1}`,
  },
  {
    // 80 is the euro sign and 93 94 are the curly quotes in windows-1252; Node 20.18's own decoder reads them as controls.
    name: 'a windows-1252 page with its euro sign and curly quotes',
    bytes: bytesOf(
      '<meta charset="windows-1252"><p>Caf',
      [0xe9, 0x20, 0x80, 0x20, 0x93],
      'q',
      [0x94],
    ),
    charset: undefined,
    markdown: 'Café € “q”',
  },
  {
    // The standard reads an ISO-8859-1 header as windows-1252: 99 is the trade mark sign.
    name: 'a page the header calls ISO-8859-1',
    bytes: bytesOf('<p>', [0x99]),
    charset: 'iso-8859-1',
    markdown: '™',
  },
  {
    name: 'a <meta> whose content names no charset',
    bytes: bytesOf('<meta http-equiv="Content-Type" content="charset="><p>Caf\u{E9}</p>'),
    charset: undefined,
    markdown: 'Caf\u{E9}',
  },
]

suite("web fetch's page converter bundle (M69)", () => {
  test('converts a page on a worker from the installed extension', async () => {
    const { convert, warnings } = startConverter()
    const html =
      '<meta charset="windows-1252"><title>Guide</title><base href="https://cdn.example.org/d/">' +
      '<script>not text</script><p hidden>Served</p><p>Caf\u{E9} <a href="x">link</a></p>'
    const outcome = await convert(
      {
        bytes: new Uint8Array(Buffer.from(html, 'latin1')),
        charset: undefined,
        url: PAGE_URL,
        maxChars: MAX_CHARS,
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

  for (const golden of GOLDENS) {
    test(`reads ${golden.name} as the standard says (PR #60)`, async () => {
      const { convert, warnings } = startConverter()
      const outcome = await convert(
        { bytes: golden.bytes, charset: golden.charset, url: PAGE_URL, maxChars: MAX_CHARS },
        new AbortController().signal,
      )
      assert.deepEqual(outcome, {
        ok: true,
        page: { title: undefined, markdown: golden.markdown, isTruncated: false },
      })
      assert.deepEqual(warnings, [])
    })
  }
})

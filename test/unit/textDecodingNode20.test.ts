import { Buffer } from 'node:buffer'
import type * as NodeUtil from 'node:util'
import { TextDecoder } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { decodeHtml } from '../../src/core/web/htmlCharset'
import { convertHtmlJob } from '../../src/core/web/htmlToMarkdown'
import { decodeIn, decodeWithBom } from '../../src/core/web/textDecoding'

// The decoder of Node 20.18.3, which is VS Code 1.99's (the floor): its TextDecoder reads
// windows-1252 as ISO-8859-1, every byte its own code point, so 0x80 to 0x9F come out as
// invisible C1 controls where the Encoding standard has the euro sign, curly quotes and
// dashes. Measured on Node 20.18.3 and on VS Code 1.99.0's Electron (Node 20.18.3 too);
// Node 24 decodes it right, so the unit run (Node 24) replays the defect here.
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeUtil>()
  const { Buffer: nodeBuffer } = await import('node:buffer')
  type DecodeArguments = Parameters<InstanceType<typeof actual.TextDecoder>['decode']>
  class Node20TextDecoder extends actual.TextDecoder {
    public override decode(...[input, options]: DecodeArguments): string {
      if (input === undefined || input === null || this.encoding !== 'windows-1252') {
        return super.decode(input, options)
      }
      const view = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input)
      return nodeBuffer.from(view).toString('latin1')
    }
  }
  return { ...actual, TextDecoder: Node20TextDecoder }
})

const EURO = 0x80
const LEFT_DOUBLE_QUOTE = 0x93

describe("windows-1252 on the floor's runtime, Node 20.18.3 (PR #60)", () => {
  it("reproduces that runtime's decoder, so the tests below prove something", () => {
    const decoder = new TextDecoder('windows-1252')
    expect(decoder.decode(new Uint8Array([EURO, LEFT_DOUBLE_QUOTE]))).toBe('\u{80}\u{93}')
    // Other encodings are the runtime's own, unchanged.
    expect(new TextDecoder('iso-8859-2').decode(new Uint8Array([0xb1]))).toBe('ą')
  })

  it("still decodes the standard's euro sign and curly quotes", () => {
    expect(decodeIn(new Uint8Array([EURO, LEFT_DOUBLE_QUOTE, 0xe9]), 'windows-1252')).toBe('€“é')
    expect(decodeWithBom(new Uint8Array([EURO]), 'windows-1252')).toBe('€')
  })

  it('reads a page declared in windows-1252 with its euro sign, header or <meta>', () => {
    const bytes = new Uint8Array([
      ...Buffer.from('<meta charset="windows-1252"><p>Caf', 'latin1'),
      0xe9,
      0x20,
      EURO,
      0x20,
      LEFT_DOUBLE_QUOTE,
    ])
    expect(decodeHtml(bytes, undefined).text.endsWith('Café € “')).toBe(true)
    expect(decodeHtml(bytes, 'iso-8859-1').text.endsWith('Café € “')).toBe(true)
    expect(
      convertHtmlJob({
        bytes,
        charset: undefined,
        url: 'https://docs.example.com/',
        maxChars: 1000,
      }),
    ).toEqual({ title: undefined, markdown: 'Café € “', isTruncated: false })
  })
})

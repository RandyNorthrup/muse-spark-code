// html-encoding-sniffer 6.0.0 ships no types: its one function (a CommonJS
// default export), as its README documents it. It returns the WHATWG name of
// the encoding (`UTF-8`, `windows-1252`, `Shift_JIS`).
declare module 'html-encoding-sniffer' {
  interface SnifferOptions {
    readonly xml?: boolean
    readonly transportLayerEncodingLabel?: string
    readonly defaultEncoding?: string
  }
  export default function sniffHtmlEncoding(bytes: Uint8Array, options?: SnifferOptions): string
}

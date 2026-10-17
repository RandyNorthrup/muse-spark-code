// What web fetch hands its HTML converter, and what comes back (M69, PLAN.md
// D49). The converter (parse5, the HTML standard's parsing algorithm) runs
// apart from the fetch: on a worker thread with its own bundle
// (src/host/web/pageWorker.ts), so the parser loads only when a page is
// converted, and a page built to be slow or large to parse is stopped at a
// time and memory limit without holding the extension host. Types only: the
// fetch imports nothing of the converter itself.

/** A fetched page as Markdown. */
export interface MarkdownPage {
  readonly title: string | undefined
  readonly markdown: string
  /** The conversion stopped at its bound: the page holds more than this. */
  readonly isTruncated: boolean
}

/** One page to convert: its bytes as fetched, the header's charset, its URL. */
export interface HtmlJob {
  readonly bytes: Uint8Array
  /** The Content-Type header's `charset`, when it names one. */
  readonly charset: string | undefined
  /** The page's final URL, against which relative links resolve (unless a `<base>` says otherwise). */
  readonly url: string
  readonly maxChars: number
}

/** Why a page was not converted: too slow, too large, in an encoding this runtime cannot decode, or the converter failed. */
export type HtmlConversionFailure = 'timeout' | 'memory' | 'failed' | 'undecodable'

export type HtmlConversion =
  | { readonly ok: true; readonly page: MarkdownPage }
  | { readonly ok: false; readonly kind: HtmlConversionFailure; readonly detail: string }

/** Converts one page; `signal` stops it. */
export type HtmlConverter = (job: HtmlJob, signal: AbortSignal) => Promise<HtmlConversion>

// Why a web fetch did not happen or did not finish (M69, PLAN.md D49): the
// sentence the model reads (English, MODEL_TEXT) and the one the Model API
// backend's row shows (the display language, UI_TEXT), made together so they
// always agree. On Muse Code the row shows the tool's own result, which is
// the model's English sentence. Nothing a server sent is echoed but short
// tokens (a media type, a coding); a network failure is named by its error
// codes, capped and redacted.

import {
  MODEL_TEXT,
  UI_TEXT,
  BYTES_PER_MIB,
  WEB_FETCH_CONVERT_MAX_HEAP_MIB,
  WEB_FETCH_CONVERT_TIMEOUT_MS,
  WEB_FETCH_MAX_BYTES,
  WEB_FETCH_MAX_REDIRECTS,
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_URL_MAX_CHARS,
} from '../../shared/constants'
import { fill, formatBytes, formatNumber, formatUnit } from '../../shared/l10n/text'

const MS_PER_SECOND = 1000
const CONVERT_SECONDS = WEB_FETCH_CONVERT_TIMEOUT_MS / MS_PER_SECOND

export type WebFetchFailureKind =
  | 'invalidUrl'
  | 'notHttps'
  | 'credentials'
  | 'urlTooLong'
  | 'reservedHost'
  | 'privateAddress'
  | 'unresolved'
  | 'nat64Unknown'
  | 'withdrawn'
  | 'tooManyRedirects'
  | 'redirectWithoutLocation'
  | 'httpStatus'
  | 'tooLarge'
  | 'noContentType'
  | 'contentType'
  | 'encoding'
  | 'conversionTimeout'
  | 'conversionMemory'
  | 'conversionFailed'
  | 'undecodable'
  | 'xhtml'
  | 'timeout'
  | 'certificate'
  | 'proxyCredentials'
  | 'proxyRefused'
  | 'unreachable'
  | 'network'

export interface WebFetchFailure {
  readonly kind: WebFetchFailureKind
  /** What the model is told, in English. */
  readonly reason: string
  /** What the row says, in the display language. */
  readonly visibleReason: string
}

/** The facts a failure's sentences name; each kind reads the ones it needs. */
export interface FailureFacts {
  readonly host?: string | undefined
  /** One address, or the addresses tried, joined. */
  readonly address?: string | undefined
  readonly status?: number | undefined
  /** A media type or a coding, only when it is a short token; else "unnamed". */
  readonly type?: string | undefined
  readonly encoding?: string | undefined
  /** A network failure's detail: its causes' error codes, redacted and capped. */
  readonly detail?: string | undefined
}

const SECONDS = WEB_FETCH_TIMEOUT_MS / MS_PER_SECOND

type Sentences = readonly [string, string]

/** The sentences that name the page's host and the address the request went to. */
function connectionSentences(kind: WebFetchFailureKind, facts: FailureFacts): Sentences {
  const values = {
    host: facts.host ?? '',
    address: facts.address ?? '',
    status: String(facts.status ?? ''),
    detail: facts.detail ?? '',
  }
  switch (kind) {
    case 'certificate': {
      return [
        fill(MODEL_TEXT.webFetchCertificate, values),
        fill(UI_TEXT.webFetchCertificate, values),
      ]
    }
    case 'proxyCredentials': {
      return [
        fill(MODEL_TEXT.webFetchProxyCredentials, values),
        fill(UI_TEXT.webFetchProxyCredentials, values),
      ]
    }
    case 'proxyRefused': {
      return [
        fill(MODEL_TEXT.webFetchProxyRefused, values),
        fill(UI_TEXT.webFetchProxyRefused, values),
      ]
    }
    case 'unreachable': {
      return [
        fill(MODEL_TEXT.webFetchUnreachable, values),
        fill(UI_TEXT.webFetchUnreachable, values),
      ]
    }
    default: {
      return [fill(MODEL_TEXT.webFetchNetwork, values), fill(UI_TEXT.webFetchNetwork, values)]
    }
  }
}

/** The sentences about what the server sent: a status, a type, a coding. */
function responseSentences(kind: WebFetchFailureKind, facts: FailureFacts): Sentences {
  const status = String(facts.status ?? '')
  switch (kind) {
    case 'redirectWithoutLocation': {
      return [
        fill(MODEL_TEXT.webFetchRedirectWithoutLocation, { status }),
        fill(UI_TEXT.webFetchRedirectWithoutLocation, { status }),
      ]
    }
    case 'httpStatus': {
      return [
        fill(MODEL_TEXT.webFetchHttpStatus, { status }),
        fill(UI_TEXT.webFetchHttpStatus, { status }),
      ]
    }
    case 'tooLarge': {
      return [
        fill(MODEL_TEXT.webFetchTooLarge, { max: String(WEB_FETCH_MAX_BYTES) }),
        fill(UI_TEXT.webFetchTooLarge, { size: formatBytes(WEB_FETCH_MAX_BYTES) }),
      ]
    }
    case 'noContentType': {
      return [MODEL_TEXT.webFetchNoContentType, UI_TEXT.webFetchNoContentType]
    }
    case 'contentType': {
      const { type } = facts
      return type === undefined
        ? [MODEL_TEXT.webFetchContentTypeUnnamed, UI_TEXT.webFetchContentTypeUnnamed]
        : [
            fill(MODEL_TEXT.webFetchContentType, { type }),
            fill(UI_TEXT.webFetchContentType, { type }),
          ]
    }
    case 'encoding': {
      const { encoding } = facts
      return encoding === undefined
        ? [MODEL_TEXT.webFetchEncodingUnnamed, UI_TEXT.webFetchEncodingUnnamed]
        : [
            fill(MODEL_TEXT.webFetchEncoding, { encoding }),
            fill(UI_TEXT.webFetchEncoding, { encoding }),
          ]
    }
    case 'conversionTimeout': {
      return [
        fill(MODEL_TEXT.webFetchConversionTimeout, { seconds: String(CONVERT_SECONDS) }),
        fill(UI_TEXT.webFetchConversionTimeout, {
          duration: formatUnit(CONVERT_SECONDS, 'second'),
        }),
      ]
    }
    case 'conversionMemory': {
      const max = WEB_FETCH_CONVERT_MAX_HEAP_MIB * BYTES_PER_MIB
      return [
        fill(MODEL_TEXT.webFetchConversionMemory, { max: String(WEB_FETCH_CONVERT_MAX_HEAP_MIB) }),
        fill(UI_TEXT.webFetchConversionMemory, { max: formatBytes(max) }),
      ]
    }
    case 'xhtml': {
      return [MODEL_TEXT.webFetchXhtml, UI_TEXT.webFetchXhtml]
    }
    case 'undecodable': {
      const encoding = facts.encoding ?? ''
      return [
        fill(MODEL_TEXT.webFetchUndecodable, { encoding }),
        fill(UI_TEXT.webFetchUndecodable, { encoding }),
      ]
    }
    case 'conversionFailed': {
      const detail = facts.detail ?? ''
      return [
        fill(MODEL_TEXT.webFetchConversionFailed, { detail }),
        fill(UI_TEXT.webFetchConversionFailed, { detail }),
      ]
    }
    default: {
      return connectionSentences(kind, facts)
    }
  }
}

/** The sentences about the URL and where it leads, before anything is sent. */
function urlSentences(kind: WebFetchFailureKind, facts: FailureFacts): Sentences {
  const host = facts.host ?? ''
  switch (kind) {
    case 'invalidUrl': {
      return [MODEL_TEXT.webFetchInvalidUrl, UI_TEXT.webFetchInvalidUrl]
    }
    case 'notHttps': {
      return [MODEL_TEXT.webFetchNotHttps, UI_TEXT.webFetchNotHttps]
    }
    case 'credentials': {
      return [MODEL_TEXT.webFetchCredentials, UI_TEXT.webFetchCredentials]
    }
    case 'urlTooLong': {
      return [
        fill(MODEL_TEXT.webFetchUrlTooLong, { max: String(WEB_FETCH_URL_MAX_CHARS) }),
        fill(UI_TEXT.webFetchUrlTooLong, { max: formatNumber(WEB_FETCH_URL_MAX_CHARS) }),
      ]
    }
    case 'reservedHost': {
      return [
        fill(MODEL_TEXT.webFetchReservedHost, { host }),
        fill(UI_TEXT.webFetchReservedHost, { host }),
      ]
    }
    case 'privateAddress': {
      const address = facts.address ?? ''
      return [
        fill(MODEL_TEXT.webFetchPrivateAddress, { host, address }),
        fill(UI_TEXT.webFetchPrivateAddress, { host, address }),
      ]
    }
    case 'unresolved': {
      return [
        fill(MODEL_TEXT.webFetchUnresolved, { host }),
        fill(UI_TEXT.webFetchUnresolved, { host }),
      ]
    }
    case 'withdrawn': {
      return [MODEL_TEXT.webFetchWithdrawn, UI_TEXT.webFetchWithdrawn]
    }
    case 'nat64Unknown': {
      const detail = facts.detail ?? ''
      return [
        fill(MODEL_TEXT.webFetchNat64Unknown, { host, detail }),
        fill(UI_TEXT.webFetchNat64Unknown, { host, detail }),
      ]
    }
    case 'tooManyRedirects': {
      return [
        fill(MODEL_TEXT.webFetchTooManyRedirects, { max: String(WEB_FETCH_MAX_REDIRECTS) }),
        fill(UI_TEXT.webFetchTooManyRedirects, { max: formatNumber(WEB_FETCH_MAX_REDIRECTS) }),
      ]
    }
    case 'timeout': {
      return [
        fill(MODEL_TEXT.webFetchTimeout, { seconds: String(SECONDS) }),
        fill(UI_TEXT.webFetchTimeout, { duration: formatUnit(SECONDS, 'second') }),
      ]
    }
    default: {
      return responseSentences(kind, facts)
    }
  }
}

export function webFetchFailure(
  kind: WebFetchFailureKind,
  facts: FailureFacts = {},
): WebFetchFailure {
  const [reason, visibleReason] = urlSentences(kind, facts)
  return { kind, reason, visibleReason }
}

/** A redirect to a refused URL: the model hears which rule refused it. */
export function redirectRefused(refusal: WebFetchFailure): WebFetchFailure {
  return {
    kind: refusal.kind,
    reason: fill(MODEL_TEXT.webFetchRedirectRefused, { reason: refusal.reason }),
    visibleReason: fill(UI_TEXT.webFetchRedirectRefused, { reason: refusal.visibleReason }),
  }
}

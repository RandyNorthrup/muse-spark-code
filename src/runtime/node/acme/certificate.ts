// Reading back an installed certificate (M110e lane A3, D90.11): after
// ACME issues, the node parses what landed and refuses anything that is
// not live for its own name. Parsing is node:crypto's own X.509 reader;
// the clock is a parameter, so expiry is judged, never assumed.
import { X509Certificate } from 'node:crypto'

const DNS_PREFIX = 'DNS:'

export interface InstalledCertificate {
  readonly notBeforeMs: number
  readonly notAfterMs: number
  readonly dnsNames: readonly string[]
}

export type InstalledCertificateVerdict =
  | { readonly ok: true; readonly certificate: InstalledCertificate }
  | { readonly ok: false; readonly reason: string }

/* Parse the PEM the installer wrote; garbage and non-certificates refuse. */
export function readInstalledCertificate(pem: string): InstalledCertificateVerdict {
  if (!pem.includes('BEGIN CERTIFICATE'))
    return { ok: false, reason: 'no certificate in this file' }
  let certificate: X509Certificate
  try {
    certificate = new X509Certificate(pem)
  } catch (error) {
    if (error instanceof Error) return { ok: false, reason: 'this certificate does not parse' }
    throw error
  }
  return {
    ok: true,
    certificate: {
      notBeforeMs: Date.parse(certificate.validFrom),
      notAfterMs: Date.parse(certificate.validTo),
      dnsNames: (certificate.subjectAltName ?? '')
        .split(', ')
        .filter((entry) => entry.startsWith(DNS_PREFIX))
        .map((entry) => entry.slice(DNS_PREFIX.length)),
    },
  }
}

function isWildcardMatch(entry: string, name: string): boolean {
  if (!entry.startsWith('*.')) return false
  const suffix = entry.slice(1)
  if (!name.endsWith(suffix)) return false
  const label = name.slice(0, name.length - suffix.length)
  return label.length > 0 && !label.includes('.')
}

/** True when the certificate is live for this name at this instant. */
export function isCertificateLiveFor(
  certificate: InstalledCertificate,
  name: string,
  atMs: number,
): boolean {
  return (
    certificate.notBeforeMs <= atMs &&
    atMs <= certificate.notAfterMs &&
    certificate.dnsNames.some((entry) => entry === name || isWildcardMatch(entry, name))
  )
}

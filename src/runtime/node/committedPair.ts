import { lstat } from 'node:fs/promises'
import {
  NODE_MAX_AUTH_BYTES,
  NODE_TLS_CERT_FILE,
  NODE_TLS_DIRECTORY,
  NODE_TLS_KEY_FILE,
} from '../../shared/constants'
import { isMissingFile, NodePrivateFiles } from './privateFiles'

export interface NodeCertificate {
  root: string
  certificateFile: string
  privateKeyFile: string
  fingerprint: string
}

/** Validates a committed pair: serve passes the auth bundle's verifier, issuance its own. */
export type CommittedPairCheck = (
  pem: string,
  key: string,
  names: readonly string[],
  now: number,
) => string

/**
The validated committed pair, or undefined when nothing is committed yet.
A crash after publication may precede the console's receipt of the pin:
recover the same validated pair; never generate over existing material.
*/
export async function readCommittedPair(
  files: NodePrivateFiles,
  names: readonly string[],
  now: () => number,
  signal: AbortSignal,
  check: CommittedPairCheck,
): Promise<NodeCertificate | undefined> {
  const committedRoot = files.file(NODE_TLS_DIRECTORY)
  try {
    await lstat(committedRoot)
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error
    return undefined
  }
  const committed = new NodePrivateFiles(committedRoot)
  const fingerprint = check(
    await committed.read(NODE_TLS_CERT_FILE, NODE_MAX_AUTH_BYTES),
    await committed.read(NODE_TLS_KEY_FILE, NODE_MAX_AUTH_BYTES),
    names,
    now(),
  )
  signal.throwIfAborted()
  return {
    root: committedRoot,
    certificateFile: NODE_TLS_CERT_FILE,
    privateKeyFile: NODE_TLS_KEY_FILE,
    fingerprint,
  }
}

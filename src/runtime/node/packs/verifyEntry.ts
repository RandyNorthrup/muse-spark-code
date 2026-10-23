// The pack index verifier's entry (M110t TP2): sigstore lives in
// dist/packsVerify.js and loads only on the first pack fetch, so the ACP
// agent's startup and argument parsing never carry it (PLAN.md D6).
import { verifyIndexBundle, type BundleVerdict } from './verify'

export type { BundleVerdict } from './verify'

export async function verifyPackIndexBundle(
  bundle: unknown,
  bytes: Uint8Array,
): Promise<BundleVerdict> {
  return await verifyIndexBundle(bundle, bytes)
}

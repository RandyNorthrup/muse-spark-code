/** M104/TRUSTED-PATH: REDM104L3 binds the POSIX verifier at integration. */
export interface TrustedPathVerifier {
  verify(
    path: string,
    options: { readonly leafKind: 'file' | 'directory' },
  ): Promise<
    | { readonly ok: true; readonly path: string }
    | { readonly refused: true; readonly component: string; readonly reason: string }
  >
}

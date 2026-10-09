/** M104/TRUSTED-PATH: REDM104L3 binds the POSIX verifier at integration. */
export interface TrustedPathVerifier {
  verify(
    path: string,
    options: {
      readonly leafKind: 'file' | 'directory'
      /**
       * The folder the caller owns (Windows: links at or above it are normal and
       * it is trusted by resolved identity; nothing below it may be a link).
       * Omitted: the leaf's own folder for a file, the leaf for a directory.
       */
      readonly root?: string | undefined
    },
  ): Promise<
    | { readonly ok: true; readonly path: string }
    | { readonly refused: true; readonly component: string; readonly reason: string }
  >
}

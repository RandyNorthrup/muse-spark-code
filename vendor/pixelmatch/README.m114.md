# Development-only pixelmatch pin

Unmodified `index.js`, `LICENSE` and `package.json` from npm pixelmatch 7.1.0
(ISC), packed on 2026-10-06. Used only by `scripts/check-visual.mjs`'s gate;
no runtime or webview imports it. No npm dependency or shared install changes.

- Tarball SHA-256: `01896a793b8fd5651df044d226db4ff093947ebfe1d25bb221a8917a70f4ec71`
- index.js SHA-256: `972e5a5387dde3b6d85ab77337d59ebafca988bf220145caa4b27dc742134dc5`
- LICENSE SHA-256: `cfec0482fb785fe27e3b368a2d9e84bf7a61b275e83ec582bf288e98cd530bb0`
- npm integrity: `sha512-1wrVzJ2STrpmONHKBy228LM1b84msXDUoAzVEl0R8Mz4Ce6EPr+IVtxm8+yvrqLYMHswREkjYFaMxnyGnaY3Ng==`

`npm view pixelmatch@7.1.0 peerDependencies dist.integrity license --json`
reported no peers and ISC. Only its zero-dependency comparator is imported;
the upstream CLI and its pngjs dependency are not used. The gate decodes
Chromium's bounded RGB/RGBA PNGs locally. The original ISC text is adjacent.

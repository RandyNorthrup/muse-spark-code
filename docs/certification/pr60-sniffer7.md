# PR #60: html-encoding-sniffer 7 compatibility

Prepared 2026-09-30 from main `327094412dac315b1f8dcf971b014c6c69b27104`.
Original bot head: `f829f28f8ef81265722a9c862f8150e134fa3423`.
Release 0.10.0 remains primary; root owns commits, pushes and merges.

## What sniffer 7 needs, and why the page worker still runs

`html-encoding-sniffer` 7.0.0 declares `engines.node` `^22.13.0 || >=24.0.0`,
no peers, and one dependency, `@exodus/bytes` `^1.15.1` (locked 1.15.2, which
declares `^20.19.0 || ^22.12.0 || >=24.0.0`). `@exodus/bytes` is ESM-only
(`"type": "module"`); the sniffer is CommonJS and `require`s its
`encoding-lite.js`, so the engines are the Node versions where `require(esm)`
works. VS Code 1.99, the extension's floor, runs Node 20.18.3 (Electron 34.3.2),
below both.

Unbundled, neither version loads there. Measured on a portable Node 20.18.3
(`node-v20.18.3-win-x64.zip`, SHA-256
`11d483dfba711bc7c9bcb513e80a2941be0c2e7cbf62753755785b9a6e80a731`, equal to
the line for that file in nodejs.org's `SHASUMS256.txt`):
`require('html-encoding-sniffer')` throws `ERR_REQUIRE_ESM` for 7.0.0 and for
the 6.0.0 that main ships, and loads on Node 24.20.0. So 7 is no worse than 6
at the floor: both work only because the page worker bundles them, and the
bundle needs nothing from Node but `node:buffer`, `node:util` and
`node:worker_threads`, which the bundle's `require` calls confirm. The
`@exodus/bytes` files that reach `dist/pageWorker.js` are `encoding-lite.js`,
its `fallback/` helpers, and the `*.node.js` UTF-8, UTF-16 and single-byte
decoders, which use `isAscii` from `node:buffer` (Node 19.6 and later) and
`Buffer` methods Node 20 has. The M69 record says the same of parse5's
`entities` ("Node 20.19 for `require(esm)` only; bundled, the worker ran on
Node 20.18.3").

## Proof on the floor

All of it runs the production or dev bundle of this branch, `dist/pageWorker.js`,
as a worker thread started the way `src/host/web/pageConverter.ts` starts it,
over real HTML bytes, with expected text written from the Encoding standard's
tables rather than taken from the code under test.

1. **Stock Node 20.18.3** (the zip above; node.exe
   `528a9aa64888a2a3ba71c6aea89434dd5ab5cb3caa9f0f31345cf5facf685ab0`; V8
   11.3, ICU 75.1). A script outside the repository runs 27 goldens: a real
   UTF-8 page (head, style, script, table, list, link), Shift_JIS, GBK, EUC-KR,
   Big5 and KOI8-R by `<meta>` or header, windows-1252, a UTF-8 byte order mark
   over a conflicting header and `<meta>`, a UTF-16LE byte order mark,
   BOM-less UTF-16LE and UTF-16BE XML signatures, an XML declaration as the
   only declaration, a late `<meta>` reparse with and without a header, a
   `<meta>` at byte 1,024 and past it, a truncated `content="charset="` and a
   truncated tag, `x-user-defined` and `replacement` labels, and three pages of
   25 KB to 360 KB (ASCII, UTF-8, windows-1252). Result: 27 of 27 passed with
   the final bundle (`dist/pageWorker.js`, 208,040 bytes, SHA-256
   `2173acf326f7ef29f168241d40eb4fe0c81f4b0b3c23ee8d29fe1ea8e86095fb`), and 27 of
   27 on Node 24.20.0 with the same file. Before the windows-1252 fix the same script failed three
   goldens on Node 20.18.3 (byte 0x80 read as a control, below) and none on Node 24; every
   sniffing golden passed on both.
2. **The same 27 on the main bundle** (sniffer 6.0.0, built from `32709441`
   with the nested 6.0.0 aliased in) on Node 20.18.3 and on Node 24.20.0 as a
   baseline: 7 and 4 failures. Four are the v6 behaviour this PR changes (an
   XML declaration or a BOM-less UTF-16 signature is not read, and a truncated
   `<meta` is taken as complete); three are the windows-1252 defect below,
   which the baseline has identically, so it is older than this PR.
3. **VS Code 1.99.0 itself**, downloaded by the integration run's `minimum`
   label (`.vscode-test.mjs`): Electron 34.3.2, Node 20.18.3, V8 13.2, ICU
   74.2. `test/integration/pageWorker.test.ts` converts pages through the
   installed extension's bundled worker: the existing windows-1252 page plus 11
   goldens added here (Shift_JIS, GBK, UTF-8 BOM over header and `<meta>`,
   BOM-less UTF-16LE and UTF-16BE, XML-declaration fallback, late `<meta>` with
   and without a header, windows-1252 euro sign and curly quotes, an
   ISO-8859-1 header, a `<meta>` naming no charset). 33 passing in that run;
   with the windows-1252 fix taken out, 31 passing and the two windows-1252
   goldens failing (I1 below).

### The defect the floor proof found (older than this PR)

Node 20.18.3's `TextDecoder` decodes `windows-1252` as ISO-8859-1. Bytes 0x80
to 0x9F therefore come out as invisible C1 controls where the Encoding
standard has the euro sign, curly quotes, dashes and the like:
`new TextDecoder('windows-1252').decode([0x80, 0x93, 0x99])` is
`"\u0080\u0093\u0099"` on Node 20.18.3 and on VS Code 1.99.0's Electron, and
`"€“™"` on Node 24.15 and 24.20 (VS Code 1.125.0 and 1.139.1). Main has it
with sniffer 6 (check 2 above), and the M69 floor proof did not see it because
it used 0xE9 only, the same byte in both. Every page the standard reads as
windows-1252 was affected on the floor: its own label and `latin1`,
`iso-8859-1` and `us-ascii`. Which releases between 1.99 and 1.125 carry it
was not measured.

`src/core/web/textDecoding.ts` now decodes windows-1252 itself, like
`x-user-defined`: ISO-8859-1 for the bytes the two agree on, and the
standard's table for 0x80 to 0x9F (the five it leaves unassigned stay their
own controls). The table was cross-checked against Node 24's decoder for all
32 bytes. A unit test file replays Node 20.18.3's decoder by mocking
`node:util` (`test/unit/textDecodingNode20.test.ts`), so the Node 24 unit run
can fail without the fix, and the two windows-1252 integration goldens fail
on the real 1.99.0 without it.

## Readiness review

The canonical adapter is `src/core/web/htmlCharset.ts`, used by the real
`convertHtmlJob` converter and the existing page worker. Reuse the BOM and
label helpers in `textDecoding.ts`; do not add a parallel charset parser.
Existing tests covered ordinary meta/header/BOM decoding and late reparse, but
not the new XML declaration/signature paths. Acceptance PR60-A/B/C is recorded
in PLAN section 7. No new model wire shape, UI string or paid call is involved.

The v7 registry metadata reports no peers, `@exodus/bytes` ^1.15.1 and Node
^22.13.0 or >=24.0.0. Main already locks @exodus/bytes 1.15.2. Installation
uses supported tooling Node, without an engine or peer bypass. The initial host
`npm audit --json` snapshot exited 0. A later Kubuntu raw audit exited 1 with
one low advisory in the existing dev-only `serialize-javascript` 7.1.1
(GHSA-gfhx-hw2g-v5hg), with no high or critical advisories. The unchanged
canonical `npm run security:audit` exited 0 on the next isolated attempt and
again in this lane (below). Raw low-advisory evidence remains retained; the
external runner was aligned to the existing repository command, without a
threshold, ignore or production source change.

The first two bounded attempts ended before test execution. Attempt 1 admitted
the exact archive and fresh npm ci, then stopped at raw audit exit 1. Attempt 2
passed npm ci, canonical audit and host types, then unit types caught nine new
fixture calls missing the existing explicit undefined header argument (TS2554).
Only those test calls were corrected; the production adapter stayed unchanged.
Both terminal receipts and logs remain outside the checkout. They are failures,
not red drills or runtime passes.

Attempt 3 passed canonical audit and both type projects, then discovered 54
owning tests: 53 passed, one newly added fixture failed because it assumed
ISO-8859-16 was unavailable on every Node. The actual Kubuntu Node 24.18.0
decoded it. The corrected fixture independently asks Node's native constructor
about availability, then requires either the known euro-byte result with certain
HTTP-header priority or the explicit UndecodableText error. It never accepts a
UTF-8 fallback. No test is skipped and no expected product result is copied from
the function under test. The two branches both ran: Node 24.20.0 (ICU 78.3)
decodes ISO-8859-16 and gives the euro sign; stock Node 20.18.3 (ICU 75.1)
throws, and the bundled worker answers `undecodable` for `iso-8859-16` (golden
27 above); VS Code 1.99.0's Electron (ICU 74.2) does decode it.

Only the existing BOM helper or the library's canonical transport-label result
can make decoding certain. The transport-label probe receives empty bytes,
because v7 still inspects XML declarations when `xml: false` and the meta limit
is zero. The real HTML prescan remains tentative: its meta declaration outranks
an XML fallback; a later meta can still reparse. The library keeps valid WHATWG
labels even when Node has no decoder, so unsupported transport encodings are
refused rather than silently downgraded to UTF-8. The obsolete v6 malformed-meta
catch is removed; unexpected library failures now propagate to the worker.

The current [HTML encoding algorithm](https://html.spec.whatwg.org/multipage/parsing.html#determining-the-character-encoding)
sets BOM and supported transport headers certain, prescan results tentative.
The [prescan](https://html.spec.whatwg.org/multipage/parsing.html#prescan-a-byte-stream-to-determine-its-encoding)
includes UTF-16 signatures and an XML fallback after HTML meta scanning.

The feature_delivery stack inventory succeeded with the repository's existing
TypeScript/JavaScript configs. Its canonical-plan validator expects a
quality-ledger that this repository's authoritative milestone PLAN does not
use; schema migration is outside this dependency repair. Structural skill
validation is deferred, not reported green. The repository's normal gates and
source-bound evidence remain authoritative.

## Red drills

Each break is made in the working tree on purpose, the named test file run
(`vitest run`, exit code recorded), and the file restored byte-exact; the
SHA-256 after restoring equals the one before. `htmlCharset.ts` (the
production adapter) is `b33c5bdc07c2…` throughout, unchanged from the source
the lane started from. The table is the final run on the final files.

D rows break the adapter and run the unit tests, F rows break the windows-1252 fix and run
the unit tests, I rows make a break and run the integration suite on the real VS Code 1.99.0
(`npm run build:dev`, then `npx vscode-test --label minimum`), G1 is the same run unbroken. The last
column is the hash of the file that was broken, after it was put back: `htmlCharset.ts`
(D1 to D7, I2 to I4) or `textDecoding.ts` (D8, F, I1, G1; `01cf589caf71…` is the final file).

| Drill | Break                                                                                     | Result                                   | First named test that failed                                                                                                                                            | sha256 after restore |
| ----- | ----------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| D1    | BOM handling: the byte order mark no longer decides first                                 | exit 1; Tests 4 failed, 19 passed (23)   | lets a byte order mark, then the header, win over the markup, and makes those certain                                                                                   | `b33c5bdc07c2`       |
| D2    | header charset: the Content-Type charset is never read                                    | exit 1; Tests 6 failed, 17 passed (23)   | lets a byte order mark, then the header, win over the markup, and makes those certain                                                                                   | `b33c5bdc07c2`       |
| D3    | meta prescan: the prescan of the page's bytes is skipped                                  | exit 1; Tests 10 failed, 13 passed (23)  | reads a <meta charset> and a <meta http-equiv> content charset                                                                                                          | `b33c5bdc07c2`       |
| D4a   | truncation: the meta prescan limit is lifted (a meta closing past byte 1024 is read)      | exit 1; Tests 2 failed, 21 passed (23)   | keeps an XML fallback tentative so a later HTML meta reparses the actual bytes                                                                                          | `b33c5bdc07c2`       |
| D4b   | truncation: the meta prescan limit is halved (a meta closing at byte 1024 is missed)      | exit 1; Tests 1 failed, 22 passed (23)   | does not use an incomplete meta or one whose closing bracket exceeds the prescan limit                                                                                  | `b33c5bdc07c2`       |
| D5    | UTF-16: a UTF-16 page may be changed by a later meta                                      | exit 1; Tests 3 failed, 20 passed (23)   | reads a BOM-less utf-16le XML signature as tentative HTML                                                                                                               | `b33c5bdc07c2`       |
| D6    | certainty: the transport-label probe sees the page's bytes (XML declaration made certain) | exit 1; Tests 1 failed, 22 passed (23)   | does not let an invalid header freeze XML or HTML prescan results                                                                                                       | `b33c5bdc07c2`       |
| D7    | invalid header: an unknown label is taken as certain                                      | exit 1; Tests 2 failed, 21 passed (23)   | reads a page that declares nothing, or an unknown label, as UTF-8                                                                                                       | `b33c5bdc07c2`       |
| D8    | UTF-16 byte order mark: a UTF-16LE mark is not recognised                                 | exit 1; Tests 2 failed, 28 passed (30)   | reads a utf-16le page by its byte order mark, over the header and its own <meta>                                                                                        | `01cf589caf71`       |
| F1    | windows-1252 table: the encoding goes back to the runtime's decoder                       | exit 1; Tests 2 failed, 31 passed (33)   | still decodes the standard's euro sign and curly quotes                                                                                                                 | `01cf589caf71`       |
| F2    | windows-1252 table: one entry wrong (0x99 as U+2121 instead of U+2122)                    | exit 1; Tests 2 failed, 8 passed (10)    | decodes windows-1252 by the standard's table, whatever this Node's decoder does                                                                                         | `01cf589caf71`       |
| F3    | windows-1252 table: the view's byte offset is ignored                                     | exit 1; Tests 1 failed, 6 passed (7)     | decodes a windows-1252 view of a larger buffer, and a long page, from the right bytes                                                                                   | `01cf589caf71`       |
| F4    | windows-1252 table: the range stops one short (0x9F stays a control)                      | exit 1; Tests 1 failed, 9 passed (10)    | decodes windows-1252 by the standard's table, whatever this Node's decoder does                                                                                         | `01cf589caf71`       |
| I1    | floor: windows-1252 goes back to the runtime's own decoder (VS Code 1.99.0, Node 20.18.3) | test exit 1; 31 passing (9s), 2 failing  | a windows-1252 page with its euro sign and curly quotes; a page the header calls ISO-8859-1                                                                             | `01cf589caf71`       |
| I2    | floor: the adapter ignores a byte order mark (VS Code 1.99.0)                             | test exit 1; 32 passing (10s), 1 failing | a UTF-8 byte order mark over a conflicting header and <meta>                                                                                                            | `b33c5bdc07c2`       |
| I3    | floor: a UTF-16 page may be changed by a later meta (VS Code 1.99.0)                      | test exit 1; 31 passing (10s), 2 failing | a UTF-16 page without a byte order mark, told by its XML signature; a big-endian UTF-16 page without a byte order mark                                                  | `b33c5bdc07c2`       |
| I4    | floor: the meta prescan is skipped (VS Code 1.99.0)                                       | test exit 1; 30 passing (10s), 3 failing | a UTF-16 page without a byte order mark, told by its XML signature; a big-endian UTF-16 page without a byte order mark; an XML declaration as a page's only declaration | `b33c5bdc07c2`       |
| G1    | no break, final source, VS Code 1.99.0                                                    | test exit 0; 33 passing (10s)            | (none)                                                                                                                                                                  | `01cf589caf71`       |

`D6` is the one break only an invalid header reveals: with a valid header the
label wins whatever the probe sees, so its named test uses `no-such-label`.

## Gates in this lane

Host: Windows 11, Node 24.20.0, npm 11.19.0, `npm ci` from the committed lockfile
(exit 0). Each gate ran once, alone, on the final files; the first lint run had found six
errors (two in the prepared tests, four in the new code), fixed in the code, none suppressed.

| Gate                                                                                                                                         | Result                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (host, webview, unit, e2e, integration)                                                                                  | exit 0                                                                                                                                |
| `npm run lint:js` (`eslint . --max-warnings=0`)                                                                                              | exit 0                                                                                                                                |
| `npm run check:l10n`, `npm run check:host-api`                                                                                               | exit 0, exit 0                                                                                                                        |
| `npm run deadcode` (knip), `npm run cycles` (dpdm)                                                                                           | exit 0, exit 0                                                                                                                        |
| `npm run duplication` (jscpd)                                                                                                                | exit 0, "Found 0 clones"                                                                                                              |
| `npm run security:audit`                                                                                                                     | exit 0: "audit: 1 advisories, 0 exceptions", the low `serialize-javascript` note                                                      |
| `npm run build` (production, with its size, split, host-globals and notices checks)                                                          | exit 0; `dist/pageWorker.js` 203.2 KiB of its 300 KiB budget (201.2 KiB on main with sniffer 6), `dist/extension.js` 562.1 of 600 KiB |
| Owning unit suites: htmlCharset, textDecoding, textDecodingNode20, htmlToMarkdown, pageConverter, webPage, webFetch, webFetcher, ideWebFetch | 9 files, 111 tests passed                                                                                                             |
| Integration, `minimum` label (VS Code 1.99.0)                                                                                                | 33 passing                                                                                                                            |
| `prettier --check .`                                                                                                                         | exit 0                                                                                                                                |

## Verification status

What is proven: sniffer 7.0.0 loads, sniffs and converts through the shipped
`dist/pageWorker.js` on stock Node 20.18.3 and in VS Code 1.99.0, the floor;
the adapter's BOM, header, prescan, truncation and UTF-16 behaviours each fail
a named test when broken, in the unit suite and on the real floor; and the
floor's windows-1252 defect is fixed and shown on the real 1.99.0 both ways.
What remains root's: the current-main join, independent review, all four full
gates and current-head CI. The full `npm run quality` for this commit is the
rig gate named in the lane report, not in this file (a commit cannot carry its
own gate result).

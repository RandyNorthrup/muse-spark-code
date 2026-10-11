# Pre-K activation sources

The 193 TypeScript inputs loaded from review revision `ad916bbc` by the
production comparison in `modelsActivationBudget.test.ts`. Sources are Git's
exact LF bytes encoded in JSON strings, so Windows checkout conversion does
not change the captured source. No Git object is needed at test time.

The JSON file's SHA-256 (after normalizing its enclosing line endings) is
`6d361ac567eb3894eaff407045daef7fcdd23cceb05cb436bd6f7f024172f4f7`.
The current production plugins rebuild that historical tree to 561,384 bytes.
The original 3,072-byte growth limit is unchanged; the repository production
bundle caps separately constrain the current activation payload.

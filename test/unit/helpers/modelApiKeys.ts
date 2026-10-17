// Synthetic Model API keys in Meta's current shape (`LLM_` and letters,
// digits, `_` or `-`, no `|`), shared by the validation and redaction tests
// so every shape the store accepts is also checked against the log redactor.
export const CURRENT_SHAPE_KEYS = [
  'LLM_TestOnly0000000000000000000000000000000000',
  'LLM_Test_Only-0000000000',
] as const

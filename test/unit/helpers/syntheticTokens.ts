// Synthetic credential shapes for the import's masking tests (M83). None is
// a real credential. Each is joined from parts when the test runs, so the
// source holds no token-shaped string for the secret scanner (gitleaks, the
// pre-commit hook and CI) to report, and no reviewer mistakes one for a leak.

const joined = (...parts: readonly string[]): string => parts.join('')

export const SYNTHETIC = {
  githubToken: joined('gh', 'p_', '0123456789abcdefghij', 'ABCDEFGHIJ'),
  openAiKey: joined('sk', '-proj-', '0123456789abcdefghij'),
  slackToken: joined('xo', 'xb-', '1234567890-abcdefghij'),
  awsAccessKey: joined('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
  bearerValue: joined('abc', '.def-123'),
} as const

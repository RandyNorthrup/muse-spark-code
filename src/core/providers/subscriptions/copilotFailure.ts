// The Copilot adapter's own failure (PLAN.md D119): the class lives in
// core beside the other provider failure types (ChatGptSignInError,
// AccountStoreError) because core's subscription dispatch tells a Copilot
// failure from any other error, while the adapter itself stays behind the
// host boundary with its VS Code imports. The message is fixed vocabulary
// per failure code; the cause carries the kind past each boundary.
export class CopilotFailureError extends Error {}

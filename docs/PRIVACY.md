# Privacy

Muse Spark Code (Unofficial) is a VS Code extension that sends what you type
to Meta's Muse Spark model. This page says what leaves your machine, where it
goes, and what stays local. It is written for the extension's users; the
security notes for contributors are in `PLAN.md` §9.

## What the extension sends, and to whom

- **Your prompts, attachments and mentioned files.** Everything you type into
  the panel, every image you paste or drop, the contents of files you
  `@`-mention, the open file or selection when the "attach open file" setting
  is on, and the outputs of the tools the agent runs (file contents,
  command output, Problems-panel diagnostics) are sent to Meta so the model
  can answer. Nothing is sent until you press Send.
- **Your own shell commands (`!`).** A message that starts with `!` runs on
  your machine, and the command with what it printed goes to Meta with the
  next request, so the model knows what you ran; Muse Code also keeps it in
  its session log. So does what a command moved to the background printed
  when it ends.
- **Through the Muse Code CLI** (what `museSpark.backend` at `auto` picks
  when the CLI is installed and signed in), the extension hands
  your messages to Meta's `muse serve` process on your machine, which talks
  to Meta with the credential from its own `muse login`. What the CLI sends
  beyond your messages (its system prompt, its own telemetry, if any) is
  governed by Meta's Muse Code terms, not by this extension.
- **Through the Meta Model API** (when you paste a key), the extension calls
  `https://api.meta.ai/v1` directly with your key. Each turn re-sends the
  conversation so far, because requests are made with `store: false`; Meta's
  Model API terms govern retention on their side.
- **Workspace rules, skills and memory.** In a trusted workspace the agent
  reads `AGENTS.md` (or `CLAUDE.md`), the skills under `.agents/skills` and
  `~/.config/muse/skills`, and `.agents/memory/MEMORY.md`, as the README
  describes. On the Model API backend the rules text, the skill catalogue
  (ids and descriptions) and the memory index go to Meta with every request
  as part of the instructions, and a skill's full text when it is loaded or
  invoked. On the Muse Code CLI backend the CLI reads and sends them under
  Meta's Muse Code terms. Nothing of this is read while VS Code has the
  folder in Restricted Mode.
- **Environment facts (Model API backend).** The instructions sent with
  every request name the workspace's absolute path, the operating system
  and shell, and today's date. In a trusted workspace that is a git
  repository they also carry the branch name, how many files `git status`
  lists as changed, and the subjects of the last five commits (never file
  contents or diffs); in Restricted Mode git is not run and none of this is
  sent. The Muse Code CLI assembles its own context under Meta's terms.
- **Contributor-tier models.** Meta may use traffic to the models whose id
  ends in `-contributor` to train its models. The extension asks once per
  conversation before using one, and refuses them entirely when the
  `museSpark.confidentialWorkspace` setting is on.

- **Voice dictation** never sends audio to Meta or to this extension's
  author. On Windows, speech is recognised by the recogniser built into
  Windows (`System.Speech`), on your machine, and the audio never leaves
  it. On macOS, Apple's Speech framework recognises on the device when its
  on-device model is installed (Apple silicon with Dictation on);
  otherwise Apple's servers transcribe the audio under Apple's privacy
  terms, and Apple decides which applies. The microphone is only
  open while the button is held or on ("Listening…"), and the recognised
  words go into the composer, where you can edit or delete them before
  anything is sent. The words are not logged (the log records only a
  character count). On macOS the microphone and speech-recognition
  permissions belong to the helper, listed as muse-dictate: macOS asks for
  them the first time you dictate, they cover the helper alone (not
  Visual Studio Code or anything else it starts), and they are revoked
  under System Settings > Privacy & Security > Microphone / Speech
  Recognition. Where macOS offers no way for the helper to ask under its
  own name, it asks as Visual Studio Code, the app that starts it.
  Dictation is off in remote windows.
- **The paid features (off unless you turn them on).** Each is billed to
  your Model API key, never to your Muse Code subscription, and each asks
  you to accept its price before it is used. All three work on the Model
  API backend; image generation and Muse Voice also work on the Muse Code
  backend while a key is stored, the images made by the extension itself
  (the key is never given to the Muse Code CLI):
  - **Web search** lets the model send search queries it writes, drawn from
    the conversation, to Meta's search; the pages it cites are listed under
    the reply and open in your browser only when you click one.
  - **Image generation** sends the prompt the model writes (you see it on
    the card, or in the dialog on the Muse Code backend, and approve each
    image) to Meta's image model, and for an edit the workspace images it
    starts from, which the card names; the image comes back and is saved in
    the workspace as a new file.
  - **Muse Voice** sends your recording to Meta's Muse Voice Transcribe
    instead of your computer's own recogniser: audio leaves the machine only
    while the microphone records on that engine, only to `api.meta.ai`, and
    the transcript comes back into the composer, where you can edit it
    before anything is sent. On Linux the recording is made by the system's
    `arecord` or `parec`. On macOS the microphone permission is asked for
    by muse-dictate, as for the free engine; no speech-recognition permission
    is needed.

The extension itself has **no telemetry**, no analytics, no crash reporting
and no server of its own. It never contacts any host other than Meta's (and,
on macOS, Apple's for dictation as described above), and only when you send
a message, sign in, dictate, or open a panel while signed in (it lists the
models then, so the model pill is filled in; that request carries no
message).

## Credentials

- A Model API key you paste is stored in VS Code's secret storage (the
  operating system's credential vault), never in settings files, logs or the
  workspace. It is sent only to `api.meta.ai` as a bearer token, and never
  passed to the Muse Code CLI or any other process.
- The Muse Code CLI's own sign-in lives in the CLI's credential file
  (`~/.config/muse/auth.json`). The extension checks only whether the file
  exists (never its contents) to decide which sign-in path to offer.
- **Sign out** in the panel (the same action as `/logout` and **Muse Spark:
  Sign Out**) deletes the pasted key from secret storage and runs
  `muse logout` when the CLI is signed in.

## What stays on your machine

- Conversation history on the Muse Code backend is the CLI's own session
  store under `~/.local/share/muse` (Meta's format). The extension reads it
  to show the History dialog and never copies it anywhere.
- Conversations on the Model API backend are saved, one JSON file each, in
  VS Code's per-workspace storage directory for this extension (the
  `storageUri` VS Code assigns; outside the repository, under your user
  profile). A file holds the messages, the tool calls and their outputs,
  the edit patches, the task list, the model and the settings of that
  conversation; never the API key. Archiving a conversation in the
  History dialog hides it; deleting the directory removes them all.
- Settings (`museSpark.*`), the archived-session list and the "last session"
  memory per panel are stored by VS Code's settings and state APIs.
- The "Muse Spark" output channel logs what the extension does, with keys
  and tokens redacted. It is not written to disk by the extension.

## Your choices

- `museSpark.confidentialWorkspace` blocks contributor-tier models and hides
  them from the model list.
- `museSpark.attachOpenFile` controls whether the active editor rides along
  with a message.
- `museSpark.respectGitIgnore` keeps ignored files out of `@`-mention
  suggestions.
- Permission modes (Manual, Edit automatically, Plan, Auto, Bypass) decide
  which tool calls run without a card; the card shows the command or path
  before anything runs.

## Contact

Questions and reports: <https://github.com/RandyNorthrup/muse-spark-code/issues>.
This project is not affiliated with Meta. "Muse Spark" and "Muse Code" are
Meta trademarks.

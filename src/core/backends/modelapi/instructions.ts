// The system instructions the Model API backend sends with every request:
// what the agent is, where it works, how to use the tools, the rules the
// permission engine enforces anyway (so the model does not waste calls on
// refused actions), the environment (PLAN.md D15: today's date and the git
// state at session start), how to work, and the workspace context of D13:
// the rules files, the skill catalogue and, with the memory tools (M49,
// D41), the memory Muse Code keeps, each present only when the workspace
// has it and is trusted; and the session goal while one is active (M45).

import {
  MEMORY_DIR,
  MEMORY_INDEX_FILE,
  MODEL_API_TOOLS,
  type MemoryScope,
} from '../../../shared/constants'
import type { ContextSections } from '../../context/workspaceContext'
import type { MemoryScopeSnapshot } from '../../memory/memoryStore'

export interface GitFacts {
  readonly branch: string
  /** Entries `git status --porcelain` listed at session start. */
  readonly changedFiles: number
  /** `git log --oneline` subjects, newest first. */
  readonly recentCommits: readonly string[]
}

export interface EnvironmentFacts {
  /** Undefined outside a git repository, or when git could not answer. */
  readonly git: GitFacts | undefined
}

export interface InstructionFacts {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly shellToolName: string
  readonly shellName: string
  /** False in Restricted Mode: the shell tool is not offered. */
  readonly hasShell: boolean
  /** True while the memory tools are offered (M49): trusted, with a memory store. */
  readonly hasMemory: boolean
  /** `YYYY-MM-DD` in the host's clock. */
  readonly today: string
  readonly environment: EnvironmentFacts
  readonly context: ContextSections
  /**
   * The session goal while it is active (M45, PLAN.md D38, `goals.ts`):
   * last, so the sections before it stay the same from call to call.
   */
  readonly goalSection?: string
}

const PARAGRAPH = '\n\n'
const LINE = '\n'
const INDENT = '  '

function baseText(facts: InstructionFacts): string[] {
  const shell = facts.hasShell
    ? `The shell tool (${facts.shellToolName}) runs one ${facts.shellName} command line in the workspace root. Give a one-line description with every command. Some actions need the user's approval; a refused action comes back as a tool error, so move on instead of retrying it.`
    : "There is no shell tool: the workspace is in VS Code's Restricted Mode, so commands cannot run until the user trusts it. Some actions need the user's approval; a refused action comes back as a tool error, so move on instead of retrying it."
  return [
    'You are Muse Spark, a coding agent working inside Visual Studio Code through the Muse Spark Code extension.',
    `The workspace root is ${facts.workspaceRoot} on ${facts.platform}. Every path you give a tool is relative to it (or absolute inside it); paths outside the workspace are refused.`,
    `Use the tools for everything that touches the workspace: read_file before editing a file, edit_file for changes inside a file (find must match exactly once), write_file to create or replace a file, search and list_files to look around${facts.hasShell ? ', and the shell tool to run commands' : ''}.`,
    shell,
    'Use ask_user when you need a decision from the user; when you offer the user a choice between options, ask through ask_user instead of listing the options in prose. Use todo_write to keep a short task list while working on several steps.',
    'Never invent file contents or command output; report what the tools returned. Answer in GitHub-flavoured Markdown, briefly, with code in fenced blocks.',
  ]
}

function gitLines(git: GitFacts | undefined): readonly string[] {
  if (git === undefined) {
    return ['- Git: not a repository, or git could not answer.']
  }
  const tree =
    git.changedFiles === 0
      ? '- Working tree at session start: clean.'
      : `- Working tree at session start: ${String(git.changedFiles)} changed entries in git status.`
  const commits =
    git.recentCommits.length === 0
      ? []
      : ['- Recent commits:', ...git.recentCommits.map((subject) => `${INDENT}- ${subject}`)]
  return [`- Git branch: ${git.branch}`, tree, ...commits]
}

function environmentText(facts: InstructionFacts): string {
  return [
    '# Environment',
    [`- Today's date: ${facts.today}`, ...gitLines(facts.environment.git)].join(LINE),
  ].join(PARAGRAPH)
}

const WORKING_RULES = [
  '# How to work',
  [
    '- Read a file before editing it, and prefer edit_file over write_file for a file that exists. write_file replaces an existing file only after you have read it, and only if it has not changed since.',
    '- Stay within what the user asked for: no extra features, refactors or files.',
    '- Never create commits, branches or pushes unless the user asks for them.',
    '- Refer to code as path:line so the user can open it.',
    '- Keep answers short: lead with the outcome, then what changed and what is next.',
    '- When something could not be verified, say so instead of guessing.',
  ].join(LINE),
].join(PARAGRAPH)

function skillsText(context: ContextSections): string | undefined {
  if (context.skills.length === 0) {
    return undefined
  }
  const rows = context.skills.map((skill) => `- ${skill.id}: ${skill.description}`)
  return [
    '# Skills',
    `These skills are available in this workspace. When a task matches one, call ${MODEL_API_TOOLS.readSkill} with its id before starting and follow its instructions. The user can also invoke one directly; its instructions then arrive with the message.`,
    rows.join(LINE),
  ].join(PARAGRAPH)
}

// What each scope is, in Muse Code's words (its migrate skill and docs).
const SCOPE_MEANINGS: Readonly<Record<MemoryScope, string>> = {
  personal_project: 'this project, private to the user, kept outside the repository (the default)',
  project: `${MEMORY_DIR} in the repository, shared with everyone who clones it; write there only when the user asks`,
  personal: "the user's notes for every project, private to the user",
}

function scopeSnapshotText(snapshot: MemoryScopeSnapshot): string {
  const notes =
    snapshot.notes.length === 0
      ? []
      : [
          `Other notes: ${snapshot.notes.join(', ')}${snapshot.hasMoreNotes ? ', and more (not listed)' : ''}.`,
        ]
  return [
    `## ${snapshot.scope}`,
    ...(snapshot.index === undefined ? [] : [`${MEMORY_INDEX_FILE}:\n${snapshot.index}`]),
    ...notes,
  ].join(PARAGRAPH)
}

function memoryText(facts: InstructionFacts): string | undefined {
  if (!facts.hasMemory) {
    return undefined
  }
  const scopes = Object.entries(SCOPE_MEANINGS).map(([scope, meaning]) => `- ${scope}: ${meaning}`)
  const snapshot =
    facts.context.memory.length === 0
      ? ['No memory notes are kept yet.']
      : [
          'The memory as this session began:',
          ...facts.context.memory.map((snapshot) => scopeSnapshotText(snapshot)),
        ]
  return [
    '# Memory',
    `Memory is Markdown notes kept for later sessions, shared with Muse Code. Save concise, verified, durable facts with ${MODEL_API_TOOLS.addMemory} (it creates a note or appends to one, and adds a new note's line to its scope's ${MEMORY_INDEX_FILE}); read a note with ${MODEL_API_TOOLS.readMemory} when it is relevant; correct an outdated fact with ${MODEL_API_TOOLS.editMemory}. Read the existing notes first so nothing is recorded twice, and keep each ${MEMORY_INDEX_FILE} line short: \`- [Title](file.md) | hook\`. The scopes:`,
    scopes.join(LINE),
    ...snapshot,
  ].join(PARAGRAPH)
}

export function instructionsFor(facts: InstructionFacts): string {
  const sections = [
    baseText(facts).join(PARAGRAPH),
    environmentText(facts),
    WORKING_RULES,
    facts.context.rules === undefined
      ? undefined
      : `# Workspace rules${PARAGRAPH}${facts.context.rules}`,
    skillsText(facts.context),
    memoryText(facts),
    facts.goalSection,
  ]
  return sections.filter((section) => section !== undefined).join(PARAGRAPH)
}

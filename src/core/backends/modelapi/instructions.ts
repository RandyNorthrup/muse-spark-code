// The system instructions the Model API backend sends with every request:
// what the agent is, where it works, how to use the tools, the rules the
// permission engine enforces anyway (so the model does not waste calls on
// refused actions), the environment (PLAN.md D15: today's date and the git
// state at session start), how to work, and the workspace context of D13:
// the rules files, the skill catalogue and the project memory index, each
// present only when the workspace has it and is trusted.

import { MEMORY_DIR, MODEL_API_TOOLS } from '../../../shared/constants'
import type { ContextSections } from '../../context/workspaceContext'

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
  /** `YYYY-MM-DD` in the host's clock. */
  readonly today: string
  readonly environment: EnvironmentFacts
  readonly context: ContextSections
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
    'Use ask_user when you need a decision from the user, and todo_write to keep a short task list while working on several steps.',
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
    '- Read a file before editing it, and prefer edit_file over write_file for a file that exists.',
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

function memoryText(context: ContextSections): string | undefined {
  if (context.memory === undefined) {
    return undefined
  }
  return [
    '# Project memory',
    `The project keeps notes under ${MEMORY_DIR}; the index (${context.memory.path}) is below. Read a note with read_file when it is relevant. To remember something for later sessions, add or update a note there with the file tools and keep one index line per note in the form \`- [Title](file.md) | hook\`.`,
    context.memory.text,
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
    memoryText(facts.context),
  ]
  return sections.filter((section) => section !== undefined).join(PARAGRAPH)
}

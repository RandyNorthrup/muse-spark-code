// The system instructions the Model API backend sends with every request:
// what the agent is, where it works, how to use the tools, the rules the
// permission engine enforces anyway (so the model does not waste calls on
// refused actions), and the workspace context of PLAN.md D13: the rules
// files, the skill catalogue and the project memory index, each present
// only when the workspace has it and is trusted.

import { MEMORY_DIR, MODEL_API_TOOLS } from '../../../shared/constants'
import type { ContextSections } from '../../context/workspaceContext'

export interface InstructionFacts {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly shellToolName: string
  readonly shellName: string
  /** False in Restricted Mode: the shell tool is not offered. */
  readonly hasShell: boolean
  readonly context: ContextSections
}

const PARAGRAPH = '\n\n'

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

function skillsText(context: ContextSections): string | undefined {
  if (context.skills.length === 0) {
    return undefined
  }
  const rows = context.skills.map((skill) => `- ${skill.id}: ${skill.description}`)
  return [
    '# Skills',
    `These skills are available in this workspace. When a task matches one, call ${MODEL_API_TOOLS.readSkill} with its id before starting and follow its instructions. The user can also invoke one directly; its instructions then arrive with the message.`,
    rows.join('\n'),
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
    facts.context.rules === undefined
      ? undefined
      : `# Workspace rules${PARAGRAPH}${facts.context.rules}`,
    skillsText(facts.context),
    memoryText(facts.context),
  ]
  return sections.filter((section) => section !== undefined).join(PARAGRAPH)
}

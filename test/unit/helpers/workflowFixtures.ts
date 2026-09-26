// A workflow run as Muse Code 1.3.0 sent it in the M47 capture (2026-09-25,
// docs/certification/m47.md): the Workflow tool call that launched it and
// the run's seven revisions with its one agent. Values are the wire's own;
// the launch result is trimmed to the fields the panel reads.

export const WORKFLOW_TURN_ID = '01a0d9f7-927d-7000-a46e-e01e393806b9'
export const WORKFLOW_ITEM_ID = '552c5897-b341-440a-87c6-4edf5189153d'
export const WORKFLOW_RUN_ID = 'workflow-run-model-tool-call_01a0d9f7b61c7128aacb297b2c9ef4ca'
export const WORKFLOW_CHILD_ID = '01a0d9f7-adee-7810-bc80-8c4c29e4a87c'
export const WORKFLOW_SCRIPT_PATH = String.raw`C:\Users\Randy\AppData\Local\Temp\muse-workflow-session-4pclcq\workflows\scripts\78b52bb7-5efb-4319-89f9-d221a30dd8e5.js`

export const WORKFLOW_SCRIPT =
  'export default async function workflow(host) { const result = await host.agent({ input: "answer with the single word pong; do not read, write or run anything.", label: "ping" }); return { status: "ok", ref: result.ref, text: result.text }; }'

/** The Workflow tool call, completed: its script and the launch Muse Code answered. */
export const WORKFLOW_TOOL_ITEM = {
  itemId: '01a0d9f7-ac1b-76e2-9ac5-8ab29fbbb661',
  kind: 'toolCall',
  turnId: WORKFLOW_TURN_ID,
  status: 'completed',
  tool: 'workflow',
  args: JSON.stringify({ script: WORKFLOW_SCRIPT }),
  visibleOutput: JSON.stringify({
    status: 'launched',
    entryId: 'generated.model-chosen',
    hostApiVersion: 'v1',
    scriptPath: WORKFLOW_SCRIPT_PATH,
    taskId: '78b52bb7-5efb-4319-89f9-d221a30dd8e5',
    workflowRunId: WORKFLOW_RUN_ID,
    maxParallelAgents: 16,
    tokenBudget: null,
  }),
}

export const WORKFLOW_MESSAGE =
  '<workflow-launch-reconciled>{"type":"workflow_launch_reconciled","call_id":"call_01a0d9f7b61c7128aacb297b2c9ef4ca","launch_command_id":"d35033f2-6e95-45d4-899a-a7ef96f62ff8","route":"runtime command admission -> production owner loop","deferred_to_background":false,"launch_admitted":true,"production_owner_loop_started":true,"child_work_started":true,"provider_or_tool_io_started":true,"final_summary_instruction":"Use final_summary.summary as the completed workflow output.","final_summary":{"status":"completed","summary":"pong"},"latest_failure":null,"agents_activity":[{"agent":"01a0d9f7-adee-7810-bc80-8c4c29e4a87c","tool_calls":0,"duration_ms":2183}],"workspace_handoffs":[{"agent":"01a0d9f7-adee-7810-bc80-8c4c29e4a87c","description":"Subagent workspace: shared"}]}</workflow-launch-reconciled>'

const RUN = {
  itemId: WORKFLOW_ITEM_ID,
  kind: 'workflow',
  turnId: WORKFLOW_TURN_ID,
  fallbackText: 'Workflow: model-chosen generated workflow',
  workflowRunId: WORKFLOW_RUN_ID,
  entryId: 'generated.model-chosen',
  scriptId: 'generated.workflow.generated.model-chosen',
  triggerSource: 'guidanceAuto',
}
const RESULT_REF =
  'subagent-result://01a0d9f7-adee-7810-bc80-8c4c29e4a87c/task/5383c082-c25b-50ca-ab8f-8bd41820afbc#5'
const ENDED = {
  childId: WORKFLOW_CHILD_ID,
  attempt: 1,
  status: 'terminal',
  durationMs: 2183,
  terminal: 'completed',
  resultRef: RESULT_REF,
}

// The run at each revision: started, updated five times, completed.
export const WORKFLOW_STARTED = { ...RUN, revision: 1, status: 'inProgress', children: [] }
export const WORKFLOW_SCHEDULED = {
  ...RUN,
  revision: 2,
  status: 'inProgress',
  children: [{ childId: WORKFLOW_CHILD_ID, attempt: 1, status: 'scheduled', label: 'ping' }],
}
export const WORKFLOW_RUNNING = {
  ...RUN,
  revision: 3,
  status: 'inProgress',
  children: [{ childId: WORKFLOW_CHILD_ID, attempt: 1, status: 'started' }],
}
export const WORKFLOW_USAGE = {
  ...RUN,
  revision: 4,
  status: 'inProgress',
  children: [
    {
      childId: WORKFLOW_CHILD_ID,
      attempt: 1,
      status: 'usage',
      usage: {
        inputTokens: 9995,
        outputTokens: 135,
        cachedTokens: 5105,
        cacheWriteTokens: 0,
        cacheReadTokens: 5105,
        reasoningTokens: 70,
      },
    },
  ],
}
export const WORKFLOW_CHILD_DONE = {
  ...RUN,
  revision: 5,
  status: 'inProgress',
  children: [
    {
      childId: WORKFLOW_CHILD_ID,
      attempt: 1,
      status: 'completed',
      durationMs: 2183,
      resultRef: RESULT_REF,
    },
  ],
}
export const WORKFLOW_CHILD_ENDED = { ...RUN, revision: 6, status: 'inProgress', children: [ENDED] }
export const WORKFLOW_COMPLETED = {
  ...RUN,
  revision: 7,
  status: 'completed',
  children: [ENDED],
  message: WORKFLOW_MESSAGE,
}

export const WORKFLOW_REVISIONS = [
  WORKFLOW_STARTED,
  WORKFLOW_SCHEDULED,
  WORKFLOW_RUNNING,
  WORKFLOW_USAGE,
  WORKFLOW_CHILD_DONE,
  WORKFLOW_CHILD_ENDED,
  WORKFLOW_COMPLETED,
]

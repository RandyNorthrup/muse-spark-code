// A separate, read-only document: no composer, conversation store or persisted state.
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import {
  type TasksHostMessage,
  tasksHostMessageSchema,
  type TasksWebviewMessage,
} from '../shared/tasksProtocol'
import { TodoPanel } from './components/TodoPanel'
import type { MessageSource } from './hostBridge'

export function TasksApp({
  messages,
  postMessage,
}: {
  readonly messages: MessageSource
  readonly postMessage: (message: TasksWebviewMessage) => void
}) {
  const [state, setState] = useState<TasksHostMessage>()
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const parsed = tasksHostMessageSchema.safeParse(event.data)
      if (parsed.success) {
        setState(parsed.data)
      }
    }
    messages.addEventListener('message', receive)
    postMessage({ type: 'tasksReady' })
    return () => {
      messages.removeEventListener('message', receive)
    }
  }, [messages, postMessage])

  const tasks =
    state !== undefined && state.items.length > 0 ? (
      <TodoPanel items={state.items} />
    ) : (
      <p role="status">{UI_TEXT.tasksTabEmpty}</p>
    )
  return (
    <main className="todo-surface">
      <header className="todo-tab-header">
        <h1>
          {state === undefined
            ? UI_TEXT.todoTitle
            : fill(UI_TEXT.tasksTabTitle, { conversation: state.conversation })}
        </h1>
        {state?.canMoveToWindow === true && (
          <button
            type="button"
            className="todo-window"
            onClick={() => {
              postMessage({ type: 'moveTasksToWindow' })
            }}
          >
            {UI_TEXT.tasksTabMoveToWindow}
          </button>
        )}
      </header>
      {state?.ended === true ? <p role="status">{UI_TEXT.tasksTabEnded}</p> : tasks}
    </main>
  )
}

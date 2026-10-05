import { useId, useState, type SubmitEvent } from 'react'
import { RUNNER_MAX_JOBS, RUNNER_PORT_MAX } from '../../../../shared/constants'
import { UI_TEXT } from '../../../../shared/l10n/text'
import { runnerSchema, type Runner } from '../../../../shared/team'

export function RunnerForm({
  runner,
  onSave,
  onCancel,
}: {
  runner?: Runner | undefined
  onSave: (runner: Runner) => void
  onCancel: () => void
}) {
  const id = useId()
  const [hasError, setHasError] = useState(false)
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const field = (name: string) => {
      const value = data.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }
    const names = (name: string) =>
      field(name)
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean)
    const port = field('port')
    const parsed = runnerSchema.safeParse({
      id: field('id'),
      destination: field('destination'),
      ...(port && { port: Number(port) }),
      os: field('os'),
      workFolder: field('workFolder'),
      maxJobs: Number(field('maxJobs')),
      labels: names('labels'),
      commandClasses: data.getAll('commandClasses'),
      setupCommand: field('setupCommand'),
      cacheKey: field('cacheKey'),
      environmentNames: names('environmentNames'),
    })
    if (!parsed.success) {
      setHasError(true)
      return
    }
    setHasError(false)
    onSave(parsed.data)
  }
  const fields = [
    { name: 'id', label: UI_TEXT.teamTrafficDetails.runnerId, value: runner?.id },
    { name: 'destination', label: UI_TEXT.teamRunners.destination, value: runner?.destination },
    { name: 'workFolder', label: UI_TEXT.teamRunners.workFolder, value: runner?.workFolder },
    { name: 'setupCommand', label: UI_TEXT.teamRunners.setupCommand, value: runner?.setupCommand },
    { name: 'cacheKey', label: UI_TEXT.teamRunners.cacheKey, value: runner?.cacheKey },
  ]
  return (
    <form onSubmit={submit} aria-label={UI_TEXT.teamRunners.add}>
      {fields.map((field) => (
        <label key={field.name} htmlFor={`${id}-${field.name}`}>
          {field.label}
          <input
            id={`${id}-${field.name}`}
            name={field.name}
            defaultValue={field.value ?? ''}
            required
            readOnly={field.name === 'id' && runner !== undefined}
          />
        </label>
      ))}
      <label htmlFor={`${id}-port`}>
        {UI_TEXT.teamRunners.port}
        <input
          id={`${id}-port`}
          name="port"
          type="number"
          min={1}
          max={RUNNER_PORT_MAX}
          defaultValue={runner?.port}
        />
      </label>
      <label htmlFor={`${id}-maxJobs`}>
        {UI_TEXT.teamRunners.maxJobs}
        <input
          id={`${id}-maxJobs`}
          name="maxJobs"
          type="number"
          min={1}
          max={RUNNER_MAX_JOBS}
          defaultValue={runner?.maxJobs ?? 1}
          required
        />
      </label>
      <label htmlFor={`${id}-os`}>
        {UI_TEXT.teamRunners.os}
        <select id={`${id}-os`} name="os" defaultValue={runner?.os ?? 'linux'}>
          {runnerSchema.shape.os.options.map((os) => (
            <option key={os} value={os}>
              {os}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-labels`}>
        {UI_TEXT.teamRunners.labels}
        <input id={`${id}-labels`} name="labels" defaultValue={runner?.labels.join(', ') ?? ''} />
      </label>
      <fieldset>
        <legend>{UI_TEXT.teamRunners.commandClasses}</legend>
        {runnerSchema.shape.commandClasses.def.element.options.map((commandClass) => (
          <label key={commandClass} htmlFor={`${id}-${commandClass}`}>
            <input
              id={`${id}-${commandClass}`}
              name="commandClasses"
              type="checkbox"
              value={commandClass}
              defaultChecked={
                runner?.commandClasses.includes(commandClass) ?? commandClass === 'tests'
              }
            />
            {UI_TEXT.teamRunners[commandClass]}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${id}-environmentNames`}>
        {UI_TEXT.teamRunners.environmentNames}
        <input
          id={`${id}-environmentNames`}
          name="environmentNames"
          defaultValue={runner?.environmentNames.join(', ') ?? ''}
        />
      </label>
      <p>{UI_TEXT.teamRunners.environmentNotice}</p>
      {hasError && <p role="alert">{UI_TEXT.teamTrafficDetails.runnerInvalid}</p>}
      <div className="traffic-actions">
        <button type="submit">{UI_TEXT.goalEditSave}</button>
        <button type="button" onClick={onCancel}>
          {UI_TEXT.installCancelAction}
        </button>
      </div>
    </form>
  )
}

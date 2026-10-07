import { type ReactNode, useState } from 'react'
import { MAKER_PROTOCOL_VERSION, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { makerSurfaceMessageSchema, type MakerSurfaceMessage } from '../../shared/makerProtocol'
import { Modal } from '../components/Modal'

const KINDS = ['moonraker', 'octoprint', 'prusalink', 'grbl', 'fluidnc', 'marlin']
const AXES = ['x', 'y', 'z']

/** Secret input is the host's credential UI; this wizard sends no key field. */
export function MachineWizard({
  send,
  onClose,
  stop,
}: {
  readonly stop: ReactNode
  readonly send: (message: MakerSurfaceMessage) => boolean
  readonly onClose: () => void
}) {
  const categoryLabels: Record<string, string> = {
    printer: UI_TEXT.makerCategoryPrinter,
    cnc: UI_TEXT.makerCategoryCnc,
    laser: UI_TEXT.makerCategoryLaser,
    robot: UI_TEXT.makerCategoryRobot,
  }
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [kind, setKind] = useState(KINDS[0] ?? '')
  const [category, setCategory] = useState(Object.keys(categoryLabels)[0] ?? '')
  const [endpoint, setEndpoint] = useState('')
  const [plainHttp, setPlainHttp] = useState(false)
  const [limits, setLimits] = useState<Record<string, string>>({})
  const [invalid, setInvalid] = useState(false)
  const isPlainHttp = endpoint.trim().toLowerCase().startsWith('http:')
  const limitNumber = (key: string) => (limits[key]?.trim() ? Number(limits[key]) : undefined)
  const limitInput = (key: string, min?: number) => (
    <input
      type="number"
      min={min}
      step="any"
      value={limits[key] ?? ''}
      onChange={(event) => {
        setLimits({ ...limits, [key]: event.target.value })
      }}
    />
  )
  const isTravelEntered = AXES.some(
    (axis) => limitNumber(`min.${axis}`) !== undefined || limitNumber(`max.${axis}`) !== undefined,
  )
  const submit = () => {
    const parsed = makerSurfaceMessageSchema.safeParse({
      v: MAKER_PROTOCOL_VERSION,
      type: 'makerAddMachine',
      allowPlainHttp: isPlainHttp && plainHttp,
      machine: {
        id: id.trim(),
        name: name.trim(),
        kind,
        category,
        endpoint: endpoint.trim(),
        limits: {
          ...(isTravelEntered && {
            travel: {
              min: { x: limitNumber('min.x'), y: limitNumber('min.y'), z: limitNumber('min.z') },
              max: { x: limitNumber('max.x'), y: limitNumber('max.y'), z: limitNumber('max.z') },
            },
          }),
          ...(limitNumber('feedMmMin') !== undefined && { feedMmMin: limitNumber('feedMmMin') }),
          ...(limitNumber('extruder') !== undefined && { extruder: limitNumber('extruder') }),
          ...(limitNumber('bed') !== undefined && { bed: limitNumber('bed') }),
        },
      },
    })
    if (!parsed.success || (isPlainHttp && !plainHttp) || !send(parsed.data)) {
      setInvalid(true)
      return
    }
    onClose()
  }
  return (
    <Modal
      title={UI_TEXT.makerAddMachine}
      titleId="maker-wizard-title"
      onClose={onClose}
      fixedControls={stop}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {[
          { label: UI_TEXT.makerName, value: name, update: setName },
          { label: UI_TEXT.makerMachineId, value: id, update: setId },
          {
            label: UI_TEXT.makerEndpoint,
            value: endpoint,
            update: (value: string) => {
              setEndpoint(value)
              setPlainHttp(false)
            },
          },
        ].map((field) => (
          <label key={field.label}>
            {field.label}
            <input
              required
              value={field.value}
              onChange={(event) => {
                field.update(event.target.value)
              }}
            />
          </label>
        ))}
        {[
          { label: UI_TEXT.makerKind, value: kind, choices: KINDS, update: setKind },
          {
            label: UI_TEXT.makerCategory,
            value: category,
            choices: Object.keys(categoryLabels),
            update: setCategory,
          },
        ].map((field) => (
          <label key={field.label}>
            {field.label}
            <select
              value={field.value}
              onChange={(event) => {
                field.update(event.target.value)
              }}
            >
              {field.choices.map((value) => (
                <option key={value} value={value}>
                  {field.label === UI_TEXT.makerCategory ? categoryLabels[value] : value}
                </option>
              ))}
            </select>
          </label>
        ))}
        {isPlainHttp && (
          <label>
            <input
              type="checkbox"
              required
              checked={plainHttp}
              onChange={(event) => {
                setPlainHttp(event.target.checked)
              }}
            />
            {UI_TEXT.makerPlainHttpWarning}
          </label>
        )}
        <fieldset>
          <legend>{UI_TEXT.makerLimitsTitle}</legend>
          <p>{UI_TEXT.makerLimitsUnavailable}</p>
          {AXES.map((axis) => (
            <div key={axis}>
              {['min', 'max'].map((bound) => (
                <label key={bound}>
                  {fill(bound === 'min' ? UI_TEXT.makerTravelMin : UI_TEXT.makerTravelMax, {
                    axis,
                  })}
                  {limitInput(`${bound}.${axis}`)}
                </label>
              ))}
            </div>
          ))}
          {[
            ['feedMmMin', UI_TEXT.makerFeed],
            ['extruder', UI_TEXT.makerExtruder],
            ['bed', UI_TEXT.makerBed],
          ].map(([key, label]) =>
            key === undefined ? null : (
              <label key={key}>
                {label}
                {limitInput(key, 0)}
              </label>
            ),
          )}
        </fieldset>
        {invalid && <p role="alert">{UI_TEXT.makerInvalidInput}</p>}
        <button type="submit">{UI_TEXT.makerAddMachine}</button>
      </form>
    </Modal>
  )
}

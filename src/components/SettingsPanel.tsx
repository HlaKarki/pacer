import { useRef } from 'react'
import type { Settings, TextSize, Theme } from '../lib/storage'
import type { ChunkSize } from '../lib/text'
import { useDismiss } from '../lib/useDismiss'

interface SettingsPanelProps {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  canExit: boolean
  showTheme: boolean
  onClose: () => void
}

interface Choice<T> {
  value: T
  label: string
}

function Choices<T extends string | number>({
  label,
  hint,
  value,
  choices,
  onChange,
}: {
  label: string
  hint?: string
  value: T
  choices: Choice<T>[]
  onChange: (value: T) => void
}) {
  return (
    <div className="pc-setting">
      <div className="pc-setting-text">
        <span className="pc-setting-label">{label}</span>
        {hint ? <span className="pc-setting-hint">{hint}</span> : null}
      </div>
      <div className="pc-segmented pc-segmented-sm" role="radiogroup" aria-label={label}>
        {choices.map((c) => (
          <button
            key={String(c.value)}
            type="button"
            role="radio"
            aria-checked={value === c.value}
            onClick={() => onChange(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const shortcuts = (canExit: boolean): [string, string][] => [
  ['Space', 'Play or pause'],
  ['← →', 'Back or forward one word'],
  ['⇧← ⇧→', 'Back or forward one sentence'],
  ['↑ ↓', 'Faster or slower'],
  ['F', 'Switch between Flow and Focus'],
  ['Esc', canExit ? 'Pause, then go back' : 'Pause'],
]

const ON_OFF: Choice<'on' | 'off'>[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

export function SettingsPanel({ settings, update, canExit, showTheme, onClose }: SettingsPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)

  return (
    <div className="pc-popover pc-settings" ref={ref} role="dialog" aria-label="Reading settings">
      <Choices<ChunkSize>
        label="Words at a time"
        hint={settings.chunk === 'phrase' ? 'Small words ride with the next word' : undefined}
        value={settings.chunk}
        choices={[
          { value: 1, label: '1' },
          { value: 2, label: '2' },
          { value: 3, label: '3' },
          { value: 'phrase', label: 'Phrase' },
        ]}
        onChange={(chunk) => update({ chunk })}
      />
      <Choices
        label="Smart pacing"
        hint={settings.smart ? 'Rare and long words get more time' : 'Every word gets the same time'}
        value={settings.smart ? 'on' : 'off'}
        choices={ON_OFF}
        onChange={(v) => update({ smart: v === 'on' })}
      />
      <Choices
        label="Pause at punctuation"
        value={settings.pauses ? 'on' : 'off'}
        choices={ON_OFF}
        onChange={(v) => update({ pauses: v === 'on' })}
      />
      <Choices<TextSize>
        label="Text size"
        value={settings.size}
        choices={[
          { value: 's', label: 'Small' },
          { value: 'm', label: 'Medium' },
          { value: 'l', label: 'Large' },
        ]}
        onChange={(size) => update({ size })}
      />
      {showTheme ? (
        <Choices<Theme>
          label="Theme"
          value={settings.theme}
          choices={[
            { value: 'system', label: 'Auto' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(theme) => update({ theme })}
        />
      ) : null}

      <dl className="pc-shortcuts">
        {shortcuts(canExit).map(([keys, action]) => (
          <div key={keys}>
            <dt>
              {keys.split(' ').map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

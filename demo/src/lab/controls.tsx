/** Dependency-free control widgets for the lab panel. */
import { useState, type ReactNode } from 'react';
import type { ParamDef } from './labParams';

export function Folder(props: {
  title: string;
  defaultOpen?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
  onDice?: () => void;
  onReset?: () => void;
  /** Count of overridden params in this folder (badge). */
  dirty?: number;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <div className={`folder${open ? ' open' : ''}`}>
      <div className="folder-head">
        <button className="folder-title" onClick={() => setOpen(!open)}>
          <span className="chev">{open ? '▾' : '▸'}</span> {props.title}
          {props.dirty ? <span className="badge">{props.dirty}</span> : null}
        </button>
        {props.onDice && (
          <button
            className="icon"
            title={props.locked ? 'locked' : 'randomize group'}
            disabled={props.locked}
            onClick={props.onDice}
          >
            🎲
          </button>
        )}
        {props.onToggleLock && (
          <button
            className={`icon${props.locked ? ' active' : ''}`}
            title="lock group (dice skips it)"
            onClick={props.onToggleLock}
          >
            {props.locked ? '🔒' : '🔓'}
          </button>
        )}
        {props.onReset && (
          <button className="icon" title="reset group to defaults" onClick={props.onReset}>
            ↺
          </button>
        )}
      </div>
      {open && <div className="folder-body">{props.children}</div>}
    </div>
  );
}

export function ParamRow(props: {
  def: ParamDef;
  value: number | string | boolean | undefined;
  onChange: (v: number | string | boolean | undefined) => void;
}): ReactNode {
  const { def } = props;
  const value = props.value ?? def.def;
  const overridden = props.value !== undefined;

  if (def.kind === 'toggle') {
    return (
      <div className={`prow${overridden ? ' dirty' : ''}`}>
        <label title={def.key}>{def.label}</label>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        {overridden && <ResetDot onClick={() => props.onChange(undefined)} />}
      </div>
    );
  }

  if (def.kind === 'select') {
    return (
      <div className={`prow${overridden ? ' dirty' : ''}`}>
        <label title={def.key}>{def.label}</label>
        <select value={String(value)} onChange={(e) => props.onChange(e.target.value)}>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {overridden && <ResetDot onClick={() => props.onChange(undefined)} />}
      </div>
    );
  }

  const num = Number(value);
  return (
    <div className={`prow${overridden ? ' dirty' : ''}`}>
      <label title={def.key}>{def.label}</label>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={num}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <input
        className="num"
        type="number"
        min={def.min}
        max={def.max}
        step={def.step}
        value={num}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {overridden && <ResetDot onClick={() => props.onChange(undefined)} />}
    </div>
  );
}

function ResetDot(props: { onClick: () => void }): ReactNode {
  return (
    <button className="reset-dot" title="reset to default" onClick={props.onClick}>
      ●
    </button>
  );
}

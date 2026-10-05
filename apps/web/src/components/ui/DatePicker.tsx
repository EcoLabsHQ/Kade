'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, JSX, KeyboardEvent, RefObject } from 'react';
import { tokens } from './tokens';

export interface DatePickerProps {
  readonly id: string;
  readonly label: string;
  readonly value: string; // ISO YYYY-MM-DD, or ''
  readonly onChange: (iso: string) => void;
  readonly placeholder?: string; // default 'dd/mm/yyyy'
  readonly invalid?: boolean;
  readonly error?: string;
  readonly hint?: string;
  readonly fromYear?: number; // default 1900
  readonly toYear?: number; // default current year
  /**
   * An accessible name for the field, for repeated pickers that share the same
   * visible label (e.g. one date of birth per household member). When omitted
   * the field is named by its `<label>`.
   */
  readonly triggerAriaLabel?: string;
  /**
   * Positions the calendar's initial view this many years before today when the
   * field is EMPTY. It only moves the view: it never pre-fills or commits a
   * value, and it is ignored when the field already has a value (the calendar
   * opens at that value instead).
   */
  readonly emptyViewYearsAgo?: number;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Parses ISO `YYYY-MM-DD` and rejects dates that do not exist. */
function parseIso(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw] = match;
  if (!yearRaw || !monthRaw || !dayRaw) return null;
  const year = Number(yearRaw);
  const month = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function toIso(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function formatDisplay(value: string): string {
  const parsed = parseIso(value);
  if (!parsed) return '';
  const dd = String(parsed.day).padStart(2, '0');
  const mm = String(parsed.month + 1).padStart(2, '0');
  return `${dd}/${mm}/${parsed.year}`;
}

function todayParts(): DateParts {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

type TypedResult =
  | { readonly ok: true; readonly iso: string }
  | { readonly ok: false; readonly error: string };

/**
 * Parses a directly typed date. Accepts `dd/mm/yyyy` and ISO `yyyy-mm-dd`, and
 * rejects text that is not a date, impossible calendar dates, future dates, and
 * years outside the picker's range.
 */
function parseTypedDate(
  raw: string,
  fromYear: number,
  toYear: number,
  todayIso: string,
): TypedResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, iso: '' };

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const dmyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);

  let year: number;
  let month: number;
  let day: number;
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (dmyMatch) {
    day = Number(dmyMatch[1]);
    month = Number(dmyMatch[2]);
    year = Number(dmyMatch[3]);
  } else {
    return { ok: false, error: 'Enter a date as dd/mm/yyyy or yyyy-mm-dd.' };
  }

  if (month < 1 || month > 12) {
    return { ok: false, error: 'Enter a month between 01 and 12.' };
  }
  if (day < 1 || day > daysInMonth(year, month - 1)) {
    return { ok: false, error: 'That date does not exist.' };
  }

  const iso = toIso(year, month - 1, day);
  if (iso > todayIso) {
    return { ok: false, error: 'Date cannot be in the future.' };
  }
  if (year < fromYear || year > toYear) {
    return { ok: false, error: `Enter a year between ${fromYear} and ${toYear}.` };
  }
  return { ok: true, iso };
}

const MonthSelect = memo(function MonthSelect({
  value,
  onChange,
}: {
  readonly value: number;
  readonly onChange: (month: number) => void;
}) {
  return (
    <select
      aria-label="Month"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      style={selectStyle}
    >
      {MONTHS.map((month, index) => (
        <option key={month} value={index}>
          {month}
        </option>
      ))}
    </select>
  );
});

/**
 * The year options are stable and the select is uncontrolled, so stepping
 * through years with the arrows does not re-render ~130 options on every step.
 * The parent syncs the DOM value through `selectRef` when the view year moves.
 */
const YearSelect = memo(
  function YearSelect({
    value,
    fromYear,
    toYear,
    onChange,
    selectRef,
  }: {
    readonly value: number;
    readonly fromYear: number;
    readonly toYear: number;
    readonly onChange: (year: number) => void;
    readonly selectRef: RefObject<HTMLSelectElement | null>;
  }) {
    const options = useMemo(() => {
      const items: JSX.Element[] = [];
      for (let year = toYear; year >= fromYear; year -= 1) {
        items.push(
          <option key={year} value={year}>
            {year}
          </option>,
        );
      }
      if (items.length === 0) {
        items.push(
          <option key={toYear} value={toYear}>
            {toYear}
          </option>,
        );
      }
      return items;
    }, [fromYear, toYear]);

    return (
      <select
        ref={selectRef}
        aria-label="Year"
        defaultValue={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={selectStyle}
      >
        {options}
      </select>
    );
  },
  (prev, next) =>
    prev.fromYear === next.fromYear &&
    prev.toYear === next.toYear &&
    prev.onChange === next.onChange &&
    prev.selectRef === next.selectRef,
);

/**
 * A styled calendar input.
 *
 * The field is directly typeable (`dd/mm/yyyy` or ISO) as well as a calendar:
 * the draft keeps ISO `YYYY-MM-DD`, the resident sees `dd/mm/yyyy`. The popover
 * is plain React state — no date library, no new dependency — and stays
 * keyboard-operable (Escape closes, arrows move the focused day, Enter/Space
 * picks it). Opening or closing the calendar never changes the value.
 */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  placeholder = 'dd/mm/yyyy',
  invalid,
  error,
  hint,
  fromYear = 1900,
  toYear = new Date().getFullYear(),
  triggerAriaLabel,
  emptyViewYearsAgo = 0,
}: DatePickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const base = baseForOpen();
    const year = clampYear(base.year);
    return { year, month: base.month };
  });
  const [focused, setFocused] = useState<DateParts>(() => {
    const base = baseForOpen();
    const year = clampYear(base.year);
    return {
      year,
      month: base.month,
      day: Math.min(base.day, daysInMonth(year, base.month)),
    };
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dayRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const yearSelectRef = useRef<HTMLSelectElement>(null);
  // Where the grid should move focus after the next render: opening the
  // calendar from the toggle/arrow keys, or moving within the grid. Left unset
  // when the field itself is clicked, so typing keeps the caret.
  const gridFocusRequest = useRef<'open' | 'move' | null>(null);

  const today = todayParts();
  const todayIso = toIso(today.year, today.month, today.day);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!gridFocusRequest.current) return;
    gridFocusRequest.current = null;
    const iso = toIso(focused.year, focused.month, focused.day);
    dayRefs.current.get(iso)?.focus();
  }, [open, focused]);

  // A value change from the parent is the source of truth: drop any draft text
  // or typed validation so the field shows the committed value again.
  useEffect(() => {
    setTyped(null);
    setInputError(null);
  }, [value]);

  // The year select is uncontrolled so its ~130 options are not re-rendered on
  // every step; keep its displayed value in step with the view imperatively.
  useEffect(() => {
    const node = yearSelectRef.current;
    if (node && node.value !== String(view.year)) {
      node.value = String(view.year);
    }
  }, [view.year, open]);

  function clampYear(year: number): number {
    return Math.min(Math.max(year, fromYear), toYear);
  }

  /**
   * The date the calendar opens on: the committed value when there is one,
   * otherwise today shifted by `emptyViewYearsAgo`. Never a value.
   */
  function baseForOpen(): DateParts {
    const parsed = parseIso(value);
    if (parsed) return parsed;
    if (emptyViewYearsAgo > 0) {
      const now = todayParts();
      const year = now.year - emptyViewYearsAgo;
      return {
        year,
        month: now.month,
        day: Math.min(now.day, daysInMonth(year, now.month)),
      };
    }
    return todayParts();
  }

  function setViewAndFocused(year: number, month: number) {
    setView({ year, month });
    setFocused((prev) => ({
      year,
      month,
      day: Math.min(prev.day, daysInMonth(year, month)),
    }));
  }

  function openCalendar() {
    const base = baseForOpen();
    const year = clampYear(base.year);
    const day = Math.min(base.day, daysInMonth(year, base.month));
    setView({ year, month: base.month });
    setFocused({ year, month: base.month, day });
    setOpen(true);
  }

  function toggleCalendar() {
    if (open) {
      setOpen(false);
      return;
    }
    gridFocusRequest.current = 'open';
    openCalendar();
  }

  function moveFocus(delta: number) {
    const next = new Date(focused.year, focused.month, focused.day + delta);
    const year = next.getFullYear();
    if (year < fromYear || year > toYear) return;
    gridFocusRequest.current = 'move';
    setFocused({ year, month: next.getMonth(), day: next.getDate() });
    setView({ year, month: next.getMonth() });
  }

  function shiftMonth(delta: number) {
    const next = new Date(view.year, view.month + delta, 1);
    const year = next.getFullYear();
    if (year < fromYear || year > toYear) return;
    setViewAndFocused(year, next.getMonth());
  }

  function shiftYear(delta: number) {
    const year = view.year + delta;
    if (year < fromYear || year > toYear) return;
    setViewAndFocused(year, view.month);
  }

  const chooseMonth = useCallback((month: number) => {
    setView((prev) => ({ year: prev.year, month }));
    setFocused((prev) => ({
      year: prev.year,
      month,
      day: Math.min(prev.day, daysInMonth(prev.year, month)),
    }));
  }, []);

  const chooseYear = useCallback(
    (year: number) => {
      const clamped = Math.min(Math.max(year, fromYear), toYear);
      setView((prev) => ({ year: clamped, month: prev.month }));
      setFocused((prev) => ({
        year: clamped,
        month: prev.month,
        day: Math.min(prev.day, daysInMonth(clamped, prev.month)),
      }));
    },
    [fromYear, toYear],
  );

  function selectDay(day: number) {
    onChange(toIso(view.year, view.month, day));
    setTyped(null);
    setInputError(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  /** Commits the typed draft, or records an inline error. Returns success. */
  function commitTyped(): boolean {
    if (typed === null) return true;
    const result = parseTypedDate(typed, fromYear, toYear, todayIso);
    if (!result.ok) {
      setInputError(result.error);
      return false;
    }
    setInputError(null);
    setTyped(null);
    if (result.iso !== value) onChange(result.iso);
    const parsed = parseIso(result.iso);
    if (parsed) {
      const year = clampYear(parsed.year);
      setView({ year, month: parsed.month });
      setFocused({ year, month: parsed.month, day: parsed.day });
    }
    return true;
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    setTyped(event.target.value);
    if (inputError) setInputError(null);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commitTyped()) setOpen(false);
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      setTyped(null);
      setInputError(null);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        gridFocusRequest.current = 'open';
        openCalendar();
      } else {
        gridFocusRequest.current = 'move';
        setFocused((prev) => ({ ...prev }));
      }
    }
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      inputRef.current?.focus();
      return;
    }
    // Arrow keys belong to the native month/year selects, not the day grid.
    if ((event.target as HTMLElement).tagName === 'SELECT') return;
    const delta =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -7
            : event.key === 'ArrowDown'
              ? 7
              : 0;
    if (delta === 0) return;
    event.preventDefault();
    moveFocus(delta);
  }

  const display = formatDisplay(value);
  const parsed = parseIso(value);
  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const totalDays = daysInMonth(view.year, view.month);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= totalDays; day += 1) cells.push(day);

  const focusedIso = toIso(focused.year, focused.month, focused.day);

  const message = inputError ?? error ?? hint;
  const messageId = message ? `${id}-message` : undefined;
  const isInvalid = Boolean(invalid) || Boolean(inputError);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 600,
          color: tokens.muted,
          marginBottom: '6px',
        }}
      >
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          aria-label={triggerAriaLabel}
          aria-haspopup="dialog"
          aria-invalid={isInvalid || undefined}
          aria-describedby={messageId}
          placeholder={placeholder}
          value={typed ?? display}
          onClick={() => {
            if (!open) openCalendar();
          }}
          onChange={handleInputChange}
          onBlur={commitTyped}
          onKeyDown={handleInputKeyDown}
          style={{
            width: '100%',
            height: '44px',
            border: `1px solid ${isInvalid ? tokens.danger : tokens.border}`,
            borderRadius: '10px',
            padding: '0 36px 0 14px',
            fontSize: '14.5px',
            fontFamily: 'inherit',
            textAlign: 'left',
            background: '#fff',
            color: display || typed ? tokens.ink : tokens.locked,
            boxSizing: 'border-box',
          }}
        />
        <button
          type="button"
          aria-label={open ? 'Close calendar' : 'Open calendar'}
          aria-expanded={open}
          onClick={toggleCalendar}
          style={toggleStyle}
        >
          ▾
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label={label}
          onKeyDown={handleGridKeyDown}
          style={{
            position: 'absolute',
            zIndex: 40,
            marginTop: '6px',
            width: '286px',
            background: '#fff',
            border: `1px solid ${tokens.border}`,
            borderRadius: '12px',
            boxShadow: '0 16px 40px rgba(16, 24, 40, 0.16)',
            padding: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '2px',
              marginBottom: '10px',
            }}
          >
            <button
              type="button"
              aria-label="Previous year"
              className="kade-datepicker-nav"
              onClick={() => shiftYear(-1)}
              style={navStyle}
            >
              «
            </button>
            <button
              type="button"
              aria-label="Previous month"
              className="kade-datepicker-nav"
              onClick={() => shiftMonth(-1)}
              style={navStyle}
            >
              ‹
            </button>
            <MonthSelect value={view.month} onChange={chooseMonth} />
            <YearSelect
              value={view.year}
              fromYear={fromYear}
              toYear={toYear}
              onChange={chooseYear}
              selectRef={yearSelectRef}
            />
            <button
              type="button"
              aria-label="Next month"
              className="kade-datepicker-nav"
              onClick={() => shiftMonth(1)}
              style={navStyle}
            >
              ›
            </button>
            <button
              type="button"
              aria-label="Next year"
              className="kade-datepicker-nav"
              onClick={() => shiftYear(1)}
              style={navStyle}
            >
              »
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '2px',
              marginBottom: '4px',
            }}
          >
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: tokens.muted,
                  textAlign: 'center',
                  padding: '2px 0',
                }}
              >
                {weekday}
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '2px',
            }}
          >
            {cells.map((day, index) => {
              if (day === null) {
                return <div key={`blank-${index}`} />;
              }
              const iso = toIso(view.year, view.month, day);
              const selected = parsed
                ? iso === toIso(parsed.year, parsed.month, parsed.day)
                : false;
              const isToday = iso === todayIso;
              return (
                <button
                  key={iso}
                  ref={(node) => {
                    if (node) dayRefs.current.set(iso, node);
                    else dayRefs.current.delete(iso);
                  }}
                  type="button"
                  className="kade-datepicker-day"
                  aria-label={iso}
                  aria-pressed={selected}
                  tabIndex={iso === focusedIso ? 0 : -1}
                  onClick={() => selectDay(day)}
                  style={{
                    height: '32px',
                    border: isToday
                      ? `1px solid ${tokens.action}`
                      : '1px solid transparent',
                    borderRadius: '8px',
                    background: selected ? tokens.action : 'transparent',
                    color: selected ? '#fff' : tokens.ink,
                    fontFamily: 'inherit',
                    fontSize: '13px',
                    fontVariantNumeric: 'tabular-nums',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {message ? (
        <div
          id={`${id}-message`}
          style={{
            fontSize: '11.5px',
            color: inputError || error ? tokens.danger : tokens.muted,
            marginTop: '6px',
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

const navStyle = {
  border: 0,
  background: 'transparent',
  color: tokens.muted,
  fontFamily: 'inherit',
  fontSize: '15px',
  lineHeight: 1,
  cursor: 'pointer',
  padding: '4px',
  borderRadius: '6px',
} as const;

const toggleStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  height: '44px',
  width: '32px',
  border: 0,
  background: 'transparent',
  color: tokens.muted,
  fontFamily: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
  padding: 0,
} as const;

const selectStyle = {
  border: 0,
  background: 'transparent',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '2px 0',
  maxWidth: '96px',
} as const;

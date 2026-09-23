'use client';

import { useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
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
   * An accessible name for the trigger, for repeated pickers that share the
   * same visible label (e.g. one date of birth per household member). When
   * omitted the trigger is named by its `<label>`.
   */
  readonly triggerAriaLabel?: string;
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

function parseIso(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw] = match;
  if (!yearRaw || !monthRaw || !dayRaw) return null;
  const year = Number(yearRaw);
  const month = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
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

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function todayParts(): DateParts {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

/**
 * A styled calendar input.
 *
 * The trigger is read-only: the draft keeps ISO `YYYY-MM-DD`, the resident sees
 * `dd/mm/yyyy`. The popover is plain React state — no date library, no new
 * dependency — and stays keyboard-operable (Escape closes, arrows move the
 * focused day, Enter/Space picks it).
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
}: DatePickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const base = parseIso(value) ?? todayParts();
    return { year: base.year, month: base.month };
  });
  const [focused, setFocused] = useState<DateParts>(
    () => parseIso(value) ?? todayParts(),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dayRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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
    const iso = toIso(focused.year, focused.month, focused.day);
    dayRefs.current.get(iso)?.focus();
  }, [open, focused]);

  function clampYear(year: number): number {
    return Math.min(Math.max(year, fromYear), toYear);
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
    const base = parseIso(value) ?? todayParts();
    const year = clampYear(base.year);
    setView({ year, month: base.month });
    setFocused({ year, month: base.month, day: base.day });
    setOpen(true);
  }

  function moveFocus(delta: number) {
    const next = new Date(focused.year, focused.month, focused.day + delta);
    const year = next.getFullYear();
    if (year < fromYear || year > toYear) return;
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

  function selectDay(day: number) {
    onChange(toIso(view.year, view.month, day));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
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
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-label={triggerAriaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        style={{
          width: '100%',
          height: '44px',
          border: `1px solid ${invalid ? tokens.danger : tokens.border}`,
          borderRadius: '10px',
          padding: '0 14px',
          fontSize: '14.5px',
          fontFamily: 'inherit',
          textAlign: 'left',
          background: '#fff',
          color: display ? tokens.ink : tokens.locked,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <span>{display || placeholder}</span>
        <span aria-hidden="true" style={{ color: tokens.muted, fontSize: '11px' }}>
          ▾
        </span>
      </button>

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
            <div
              style={{
                fontSize: '13.5px',
                fontWeight: 700,
                color: tokens.ink,
                minWidth: '110px',
                textAlign: 'center',
              }}
            >
              {MONTHS[view.month] ?? ''} {view.year}
            </div>
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

      {error ? (
        <div
          id={`${id}-message`}
          style={{ fontSize: '11.5px', color: tokens.danger, marginTop: '6px' }}
        >
          {error}
        </div>
      ) : hint ? (
        <div
          id={`${id}-message`}
          style={{ fontSize: '11.5px', color: tokens.muted, marginTop: '6px' }}
        >
          {hint}
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
  padding: '4px 6px',
  borderRadius: '6px',
} as const;

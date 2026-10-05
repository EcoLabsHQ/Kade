import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DatePicker } from '@/components/ui/DatePicker';
import type { DatePickerProps } from '@/components/ui/DatePicker';

afterEach(cleanup);

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH_INDEX = NOW.getMonth();
const MONTH = String(MONTH_INDEX + 1).padStart(2, '0');

/** Renders the picker as its callers do: a controlled value with a spy seam. */
function renderPicker(
  overrides: Partial<DatePickerProps> = {},
  options: { initial?: string; onChange?: (iso: string) => void } = {},
) {
  const onChange = options.onChange ?? vi.fn();
  function Wrapper() {
    const [value, setValue] = useState(options.initial ?? '');
    return (
      <DatePicker
        id="dob"
        label="Date of birth"
        {...overrides}
        value={value}
        onChange={(iso) => {
          setValue(iso);
          onChange(iso);
        }}
      />
    );
  }
  render(<Wrapper />);
  return { onChange };
}

function openCalendar() {
  fireEvent.click(screen.getByRole('textbox', { name: 'Date of birth' }));
}

describe('typing a date directly', () => {
  it('accepts dd/mm/yyyy and commits it as ISO', () => {
    const { onChange } = renderPicker();
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: '15/06/1985' } });
    fireEvent.blur(field);

    expect(onChange).toHaveBeenCalledWith('1985-06-15');
    expect(field).toHaveValue('15/06/1985');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('accepts the ISO form too', () => {
    const { onChange } = renderPicker();
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: '1985-06-15' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('1985-06-15');
    expect(field).toHaveValue('15/06/1985');
  });

  it('rejects an impossible date with an inline error and does not commit', () => {
    const { onChange } = renderPicker();
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: '31/02/1985' } });
    fireEvent.blur(field);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('That date does not exist.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveValue('31/02/1985');
  });

  it('rejects a future date with an inline error and does not commit', () => {
    const { onChange } = renderPicker({ toYear: YEAR + 5 });
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: `${YEAR + 3}-01-01` } });
    fireEvent.blur(field);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Date cannot be in the future.')).toBeInTheDocument();
  });

  it('rejects text that is not a date', () => {
    const { onChange } = renderPicker();
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: 'yesterday' } });
    fireEvent.blur(field);

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText('Enter a date as dd/mm/yyyy or yyyy-mm-dd.'),
    ).toBeInTheDocument();
  });

  it('keeps an existing value when the typed replacement is invalid', () => {
    const { onChange } = renderPicker({}, { initial: '1985-06-15' });
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: '31/02/1985' } });
    fireEvent.blur(field);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('That date does not exist.')).toBeInTheDocument();
  });

  it('clears the committed value when the field is emptied', () => {
    const { onChange } = renderPicker({}, { initial: '1985-06-15' });
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);

    expect(onChange).toHaveBeenCalledWith('');
    expect(field).toHaveValue('');
  });

  it('rejects a year outside the configured range', () => {
    const { onChange } = renderPicker({ fromYear: 1950, toYear: 2000 });
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: '1900-01-01' } });
    fireEvent.blur(field);

    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText('Enter a year between 1950 and 2000.'),
    ).toBeInTheDocument();
  });

  it('recovers: a valid retype commits and clears the error', () => {
    const { onChange } = renderPicker();
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    fireEvent.change(field, { target: { value: '31/02/1985' } });
    fireEvent.blur(field);
    expect(screen.getByText('That date does not exist.')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '15/06/1985' } });
    fireEvent.blur(field);

    expect(onChange).toHaveBeenCalledWith('1985-06-15');
    expect(screen.queryByText('That date does not exist.')).toBeNull();
  });
});

describe('choosing a month and a year directly', () => {
  it('changes the view month in one interaction', () => {
    renderPicker();
    openCalendar();

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '5' } });

    expect(screen.getByLabelText('Month')).toHaveValue('5');
    expect(
      screen.getByRole('button', { name: `${YEAR}-06-15` }),
    ).toBeInTheDocument();
  });

  it('changes the view year in one interaction', () => {
    renderPicker();
    openCalendar();

    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1985' } });

    expect(screen.getByLabelText('Year')).toHaveValue('1985');
    expect(
      screen.getByRole('button', { name: `1985-${MONTH}-15` }),
    ).toBeInTheDocument();
  });

  it('only offers years inside the configured range', () => {
    renderPicker({ fromYear: 1950, toYear: 2000 });
    openCalendar();

    const year = screen.getByLabelText('Year');
    expect(
      within(year).getByRole('option', { name: '1950' }),
    ).toBeInTheDocument();
    expect(
      within(year).getByRole('option', { name: '2000' }),
    ).toBeInTheDocument();
    expect(within(year).queryByRole('option', { name: '1949' })).toBeNull();
    expect(within(year).queryByRole('option', { name: '2001' })).toBeNull();
  });

  it('does not commit a value just by changing the view', () => {
    const { onChange } = renderPicker();
    openCalendar();

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1985' } });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Date of birth' })).toHaveValue('');
  });
});

describe('positioning the initial view with emptyViewYearsAgo', () => {
  it('opens at the offset when the field is empty, without committing', () => {
    const { onChange } = renderPicker({ emptyViewYearsAgo: 40 });
    openCalendar();

    expect(screen.getByLabelText('Year')).toHaveValue(String(YEAR - 40));
    expect(
      screen.getByRole('button', { name: `${YEAR - 40}-${MONTH}-15` }),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Date of birth' })).toHaveValue('');
  });

  it('leaves the value empty when the calendar is opened and closed', () => {
    const { onChange } = renderPicker({ emptyViewYearsAgo: 40 });
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    openCalendar();
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field).toHaveValue('');
  });

  it('ignores the offset when the field already has a value', () => {
    renderPicker(
      { emptyViewYearsAgo: 40 },
      { initial: '1985-06-15' },
    );
    openCalendar();

    expect(screen.getByLabelText('Year')).toHaveValue('1985');
    expect(screen.getByLabelText('Month')).toHaveValue('5');
  });

  it('still commits a chosen day after opening at the offset', () => {
    const { onChange } = renderPicker({ emptyViewYearsAgo: 40 });
    openCalendar();

    fireEvent.click(
      screen.getByRole('button', { name: `${YEAR - 40}-${MONTH}-15` }),
    );

    expect(onChange).toHaveBeenCalledWith(`${YEAR - 40}-${MONTH}-15`);
    expect(screen.getByRole('textbox', { name: 'Date of birth' })).toHaveValue(
      `15/${MONTH}/${YEAR - 40}`,
    );
  });
});

describe('preserved picker behaviour', () => {
  it('is a text field, not a native date input, and is reachable by its label', () => {
    renderPicker();

    const field = screen.getByRole('textbox', { name: 'Date of birth' });
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveAttribute('placeholder', 'dd/mm/yyyy');
    expect(field).toHaveValue('');
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('exposes dialog semantics and toggles aria-expanded', () => {
    renderPicker();
    const field = screen.getByRole('textbox', { name: 'Date of birth' });

    expect(field).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.getByLabelText('Open calendar')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    openCalendar();
    expect(screen.getByLabelText('Close calendar')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      screen.getByRole('dialog', { name: 'Date of birth' }),
    ).toBeInTheDocument();

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.getByLabelText('Open calendar')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('wires an external error to aria-describedby and aria-invalid', () => {
    renderPicker({ invalid: true, error: 'Date of birth is required.' });

    const field = screen.getByRole('textbox', { name: 'Date of birth' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAttribute('aria-describedby', 'dob-message');
    expect(screen.getByText('Date of birth is required.')).toBeInTheDocument();
  });

  it('shows a hint when there is no error', () => {
    renderPicker({ hint: 'You must be at least 18.' });

    const field = screen.getByRole('textbox', { name: 'Date of birth' });
    expect(field).toHaveAttribute('aria-describedby', 'dob-message');
    expect(screen.getByText('You must be at least 18.')).toBeInTheDocument();
  });

  it('opens at the committed value', () => {
    renderPicker({}, { initial: '1985-06-15' });
    openCalendar();

    expect(screen.getByLabelText('Year')).toHaveValue('1985');
    expect(screen.getByLabelText('Month')).toHaveValue('5');
  });

  it('picks a day from the calendar and shows dd/mm/yyyy', () => {
    const { onChange } = renderPicker();
    openCalendar();

    fireEvent.click(screen.getByRole('button', { name: `${YEAR}-${MONTH}-15` }));

    expect(onChange).toHaveBeenCalledWith(`${YEAR}-${MONTH}-15`);
    expect(screen.getByRole('textbox', { name: 'Date of birth' })).toHaveValue(
      `15/${MONTH}/${YEAR}`,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves the focused day with the arrow keys and keeps one tab stop', () => {
    renderPicker();
    openCalendar();

    const dialog = screen.getByRole('dialog', { name: 'Date of birth' });
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });

    const next = new Date(YEAR, MONTH_INDEX, NOW.getDate() + 1);
    const nextIso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(next.getDate()).padStart(2, '0')}`;
    const nextDay = screen.getByRole('button', { name: nextIso });

    expect(nextDay).toHaveFocus();
    expect(nextDay).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: `${YEAR}-${MONTH}-${String(
      NOW.getDate(),
    ).padStart(2, '0')}` })).toHaveAttribute('tabindex', '-1');
  });

  it('respects fromYear/toYear when navigating with the arrows', () => {
    renderPicker({ fromYear: YEAR, toYear: YEAR });
    openCalendar();

    // The only allowed year is the current one, so the previous-year arrow is
    // inert rather than navigating out of range.
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    expect(screen.getByLabelText('Year')).toHaveValue(String(YEAR));
  });
});

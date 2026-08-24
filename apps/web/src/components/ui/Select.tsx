/**
 * Select — native <select> wrapper styled with OntoDecide tokens.
 */
import { forwardRef, OptionHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export interface SelectOption extends Omit<OptionHTMLAttributes<HTMLOptionElement>, 'label'> {
  label: ReactNode;
  value: string | number;
}
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  invalid?: boolean;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', style, options, invalid, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={className}
      style={{
        width: '100%', padding: '10px 32px 10px 12px', fontSize: 14,
        borderRadius: 'var(--radius-md)', background: '#fff',
        border: `1px solid ${invalid ? 'var(--color-danger)' : 'var(--color-neutral-300)'}`,
        color: 'var(--color-neutral-900)', fontFamily: 'inherit',
        appearance: 'none',
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        ...style,
      }}
      {...rest}
    >
      {options.map((o, i) => (
        <option key={i} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
});

export default Select;

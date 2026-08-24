/**
 * Tabs — segmented tab control. Use <Tabs value={..} onChange={..}><Tab value/><Tab../></Tabs>.
 */
import { Children, HTMLAttributes, ReactElement, ReactNode, useState } from 'react';

export interface TabProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  label: ReactNode;
  children?: ReactNode;
}
export function Tab(_props: TabProps) {
  return null; // Rendering delegated to parent <Tabs />.
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  children: ReactElement<TabProps> | ReactElement<TabProps>[];
}

export default function Tabs({
  value, defaultValue, onChange, className = '', style, children, ...rest
}: TabsProps) {
  const arr = Children.toArray(children) as ReactElement<TabProps>[];
  const first = arr[0]?.props.value ?? '';
  const [internal, setInternal] = useState<string>(defaultValue ?? first);
  const current = value ?? internal;
  const set = (v: string) => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };
  const active = arr.find((c) => c.props.value === current) ?? arr[0];
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', ...style }} {...rest}>
      <div
        role="tablist"
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 0,
          borderBottom: '1px solid var(--color-neutral-200)',
        }}
      >
        {arr.map((c) => {
          const selected = c.props.value === current;
          return (
            <button
              key={c.props.value}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => set(c.props.value)}
              style={{
                padding: '10px 16px', background: 'transparent',
                border: 'none', borderBottom: `2px solid ${selected ? 'var(--color-primary)' : 'transparent'}`,
                color: selected ? 'var(--color-primary)' : 'var(--color-neutral-500)',
                fontWeight: selected ? 600 : 500, fontSize: 14,
                cursor: 'pointer', transition: 'color .15s ease',
                fontFamily: 'inherit',
              }}
            >
              {c.props.label}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          role="tabpanel"
          style={{ padding: 'var(--space-3) 0' }}
        >
          {active.props.children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Card — container with header/content/footer slots. Soft shadow & radius.
 * Named exports: Card, CardHeader, CardContent, CardFooter.
 */
import { HTMLAttributes, ReactNode } from 'react';

type Props = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--color-neutral-200)',
  boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column',
  minWidth: 0,
};
export function Card({ className = '', style, children, ...rest }: Props) {
  return (
    <div className={className} style={{ ...cardStyle, ...style }} {...rest}>
      {children}
    </div>
  );
}
export function CardHeader({ className = '', style, children, ...rest }: Props) {
  return (
    <div
      className={className}
      style={{
        padding: 'var(--space-3) var(--space-3) var(--space-2)',
        borderBottom: '1px solid var(--color-neutral-200)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 'var(--space-2)', ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
export function CardContent({ className = '', style, children, ...rest }: Props) {
  return (
    <div
      className={className}
      style={{ padding: 'var(--space-3)', flex: 1, minWidth: 0, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
export function CardFooter({ className = '', style, children, ...rest }: Props) {
  return (
    <div
      className={className}
      style={{
        padding: 'var(--space-2) var(--space-3) var(--space-3)',
        borderTop: '1px solid var(--color-neutral-200)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)', ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
export default Card;

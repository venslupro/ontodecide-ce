/**
 * ApiErrorAlert — renders an ApiError payload inside an Alert banner.
 * Accepts `null` for ergonomic conditional rendering.
 */
import { HTMLAttributes } from 'react';
import type { ApiError } from '@ontodecide/shared';
import Alert from '@/components/ui/Alert';

export interface ApiErrorAlertProps extends HTMLAttributes<HTMLDivElement> {
  error: ApiError | null | undefined;
  onClose?: () => void;
  titlePrefix?: string;
}

export default function ApiErrorAlert({
  error, onClose, titlePrefix = 'Request failed',
  className = '', style, ...rest
}: ApiErrorAlertProps) {
  if (!error) return null;
  const details = error.details && Object.keys(error.details).length > 0
    ? Object.entries(error.details)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ')
    : undefined;
  return (
    <Alert
      tone="danger"
      title={
        <span>
          {titlePrefix}
          {error.code ? (
            <code style={{
              marginLeft: 8, fontSize: 11,
              background: 'rgba(0,0,0,0.06)', padding: '1px 6px',
              borderRadius: 4,
            }}>
              {error.code}
            </code>
          ) : null}
        </span>
      }
      className={className}
      style={style}
      onClose={onClose}
      {...rest}
    >
      <div>{error.message}</div>
      {details ? (
        <div style={{ marginTop: 4, fontSize: 12 }}>{details}</div>
      ) : null}
    </Alert>
  );
}

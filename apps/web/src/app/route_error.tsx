/**
 * @fileoverview Route-level error boundary view: error id, traceId (API
 * errors) and "reload". Logged locally only (no telemetry in CE).
 */

import type {ErrorComponentProps} from '@tanstack/react-router';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {errorMessage, errorTraceId} from '../shared/api/error_message';
import {newErrorId, reportError} from '../shared/lib/error_report';
import {ErrorView} from '../shared/ui/empty_state';

/** Route error component. */
export function RouteError({error}: ErrorComponentProps) {
  const {t} = useTranslation('common');
  const [errorId] = useState(newErrorId);
  const traceId = errorTraceId(error);
  useEffect(() => {
    reportError(error, {errorId, traceId});
  }, [error, errorId, traceId]);
  return (
    <div className="glass mx-auto mt-10 max-w-xl">
      <ErrorView
        title={t('errors.RENDER')}
        detail={errorMessage(error, t)}
        errorId={errorId}
        traceId={traceId}
        onRetry={() => location.reload()}
      />
    </div>
  );
}

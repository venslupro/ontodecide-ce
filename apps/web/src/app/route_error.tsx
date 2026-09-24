/**
 * @fileoverview Route-level error boundary view: error id + reload, and the
 * error is reported through telemetry.
 */

import type {ErrorComponentProps} from '@tanstack/react-router';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../shared/api/error_message';
import {isApiError} from '../shared/api/errors';
import {newErrorId, reportError} from '../shared/lib/telemetry';
import {ErrorView} from '../shared/ui/empty_state';

/** Route error component. */
export function RouteError({error}: ErrorComponentProps) {
  const {t} = useTranslation('common');
  const [errorId] = useState(newErrorId);
  useEffect(() => {
    reportError(error, {
      errorId,
      requestId: isApiError(error) ? error.requestId : undefined,
    });
  }, [error, errorId]);
  return (
    <div className="glass mx-auto mt-10 max-w-xl">
      <ErrorView
        title={t('errors.renderFailed')}
        detail={errorMessage(error, t)}
        errorId={errorId}
        onRetry={() => location.reload()}
      />
    </div>
  );
}

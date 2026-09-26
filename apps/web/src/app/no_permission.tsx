/**
 * @fileoverview Page-level "no permission" view showing the required role.
 */

import type {Role} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {ShieldAlert} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Button} from '../shared/ui/button';
import {EmptyState} from '../shared/ui/empty_state';

/** Shown when the user's role is below the route's minimum role. */
export function NoPermission({required}: {required: Role}) {
  const {t} = useTranslation('common');
  return (
    <div className="glass mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<ShieldAlert aria-hidden />}
        title={t('errors.FORBIDDEN')}
        description={t('permission.required', {role: t(`roles.${required}`)})}
        action={
          <Button asChild variant="secondary">
            <Link to="/cockpit">{t('actions.backHome')}</Link>
          </Button>
        }
      />
    </div>
  );
}

/**
 * @fileoverview 403 page "无权执行该操作" (owner visiting /admin).
 */

import {Link} from '@tanstack/react-router';
import {ShieldX} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Button} from '../shared/ui/button';
import {EmptyState} from '../shared/ui/empty_state';

/** Forbidden page. */
export function ForbiddenPage() {
  const {t} = useTranslation('common');
  return (
    <div className="glass mx-auto mt-10 max-w-xl">
      <EmptyState
        icon={<ShieldX aria-hidden />}
        title={t('errors.FORBIDDEN')}
        description={t('forbidden.body')}
        action={
          <Button asChild variant="primary">
            <Link to="/cockpit">{t('forbidden.back')}</Link>
          </Button>
        }
      />
    </div>
  );
}

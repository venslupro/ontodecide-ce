/**
 * @fileoverview 404 page.
 */

import {Link} from '@tanstack/react-router';
import {Compass} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {Button} from '../shared/ui/button';
import {EmptyState} from '../shared/ui/empty_state';

/** Not found. */
export function NotFoundPage() {
  const {t} = useTranslation('common');
  return (
    <div className="glass mx-auto mt-16 max-w-lg">
      <EmptyState
        icon={<Compass aria-hidden />}
        title={t('errors.pageNotFound')}
        action={
          <Button asChild variant="secondary">
            <Link to="/cockpit">{t('actions.backHome')}</Link>
          </Button>
        }
      />
    </div>
  );
}

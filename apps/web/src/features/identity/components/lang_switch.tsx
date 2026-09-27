/**
 * @fileoverview 中文 | EN switch (top bar, auth pages, account page).
 */

import {useQueryClient} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {normalizeLang, type Lang} from '../../../shared/lib/i18n';
import {Segmented} from '../../../shared/ui/segmented';
import {switchLanguage} from '../language';

/** Language segmented control. */
export function LangSwitch({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  const {t, i18n} = useTranslation('common');
  const qc = useQueryClient();
  const value = normalizeLang(i18n.language) ?? 'zh-CN';
  return (
    <Segmented<Lang>
      label={t('lang.label')}
      value={value}
      size={size}
      className={className}
      options={[
        {value: 'zh-CN', label: '中文'},
        {value: 'en-US', label: 'EN', ariaLabel: 'English'},
      ]}
      onChange={l => void switchLanguage(l, qc)}
    />
  );
}

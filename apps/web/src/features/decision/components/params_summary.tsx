/**
 * @fileoverview Compact action-parameter summary: parameter display names from
 * the UI model; object reference values rendered as object links (or titles).
 */

import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import {looksLikeRid, paramText} from '../model';
import {ObjectLink, useObjectTitle} from './object_link';

function RefTitle({rid}: {rid: string}) {
  return <span className="text-text">{useObjectTitle(rid)}</span>;
}

/** `name: value · name: value` summary of an action's params. */
export function ParamsSummary({
  actionType,
  params,
  links = true,
}: {
  actionType: string;
  params: Record<string, unknown>;
  /** Render object references as links (false inside labels/buttons). */
  links?: boolean;
}) {
  const {t} = useTranslation('scenarios');
  const {model} = useUiModel();
  const def = model.actions.find(a => a.apiName === actionType);
  const entries = Object.entries(params ?? {});
  if (entries.length === 0)
    return <span className="text-dim">{t('candidates.noParams')}</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5">
      {entries.map(([k, v]) => {
        const name =
          def?.parameters.find(p => p.apiName === k)?.displayName ?? k;
        return (
          <span key={k} className="whitespace-nowrap">
            <span className="text-muted">{name}</span>
            <span className="text-dim">: </span>
            {looksLikeRid(v) ? (
              links ? (
                <ObjectLink rid={v} />
              ) : (
                <RefTitle rid={v} />
              )
            ) : (
              <span className="text-text num">{paramText(v)}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

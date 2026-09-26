/**
 * @fileoverview Filter popover for the object table: the shared
 * FilterBuilder over the type's indexed, visible properties. Applying emits
 * a FilterExpr (written to `?filter=` by the page).
 */

import type {FilterExpr} from '@ontodecide/shared-kernel';
import {Filter} from 'lucide-react';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FilterBuilder} from '../../entities/object_set/filter_builder';
import {
  countConditions,
  fromFilterExpr,
  toFilterExpr,
  type FilterGroup,
} from '../../entities/object_set/filter_model';
import type {RenderProp} from '../../entities/renderers/registry';
import type {UiObjectType} from '../../entities/schema/model';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Popover, PopoverContent, PopoverTrigger} from '../../shared/ui/popover';

/** Filter popover props. */
export interface FilterPanelProps {
  type: UiObjectType;
  value: FilterExpr | undefined;
  /** Active condition count (badge). */
  count: number;
  disabled?: boolean;
  onApply(next: FilterExpr | undefined): void;
}

/** Filter builder in a popover. */
export function FilterPanel({
  type,
  value,
  count,
  disabled,
  onApply,
}: FilterPanelProps) {
  const {t} = useTranslation('objects');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterGroup>(() => fromFilterExpr(value));
  const props = useMemo<RenderProp[]>(
    () =>
      type.properties
        .filter(p => p.indexed && p.visible)
        .map(p => ({
          apiName: p.apiName,
          displayName: p.displayName,
          dataType: p.dataType,
          unit: p.unit,
          enumValues: p.enumValues,
        })),
    [type.properties],
  );
  const byName = useMemo(
    () => Object.fromEntries(props.map(p => [p.apiName, p])),
    [props],
  );

  return (
    <Popover
      open={open}
      onOpenChange={o => {
        if (o) setDraft(fromFilterExpr(value));
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          disabled={disabled}
          aria-label={
            count ? t('list.filterWithCount', {count}) : t('list.filter')
          }
        >
          <Filter aria-hidden />
          {t('list.filter')}
          {count > 0 && (
            <Badge tone="cyan" className="ml-0.5 px-1.5">
              {count}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(40rem,calc(100vw-32px))]" align="start">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-text">
            {t('list.filterTitle')}
          </p>
          <span className="text-xs text-dim">
            {t('list.filterIndexedOnly')}
          </span>
        </div>
        {props.length === 0 ? (
          <p className="text-xs text-muted">{t('list.noIndexed')}</p>
        ) : (
          <FilterBuilder
            label={t('list.filterTitle')}
            value={draft}
            onChange={setDraft}
            properties={props}
          />
        )}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-xs text-muted">
            {t('list.filterActive', {count: countConditions(draft)})}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onApply(undefined);
                setOpen(false);
              }}
            >
              {t('common:actions.clear')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onApply(toFilterExpr(draft, byName));
                setOpen(false);
              }}
            >
              {t('common:actions.apply')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

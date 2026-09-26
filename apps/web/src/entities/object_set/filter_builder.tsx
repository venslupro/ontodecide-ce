/**
 * @fileoverview Filter / condition builder: nested AND/OR groups of
 * property → operator → value rows. Fully keyboard operable (native
 * selects, buttons, inputs); produces a {@link FilterGroup} that converts
 * to a FilterExpr with `toFilterExpr`.
 */

import {Plus, Trash2, FolderPlus} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type MutableRefObject,
} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../shared/lib/cn';
import {Button} from '../../shared/ui/button';
import {Input} from '../../shared/ui/input';
import {NativeSelect} from '../../shared/ui/select';
import {
  type FilterOp,
  getRenderer,
  rendererKey,
  type RenderProp,
} from '../renderers/registry';
import {
  type FilterCondition,
  type FilterGroup,
  newCondition,
  newGroup,
  opIsUnary,
} from './filter_model';

/** Builder props. */
export interface FilterBuilderProps {
  value: FilterGroup;
  onChange(next: FilterGroup): void;
  /** Properties offered in the property select. */
  properties: RenderProp[];
  /** Maximum nesting depth of groups (default 2). */
  maxDepth?: number;
  /** Accessible name of the whole builder. */
  label?: string;
  className?: string;
}

/** Id of a just-added condition whose property select should take focus. */
const FocusCtx = createContext<MutableRefObject<string | null> | null>(null);

function replaceItem(
  g: FilterGroup,
  id: string,
  next: FilterCondition | FilterGroup | null,
): FilterGroup {
  return {
    ...g,
    items: g.items.flatMap(i => {
      if (i.id === id) return next ? [next] : [];
      return i.kind === 'group' ? [replaceItem(i, id, next)] : [i];
    }),
  };
}

function ConditionRow({
  cond,
  properties,
  onChange,
  onRemove,
  index,
}: {
  cond: FilterCondition;
  properties: RenderProp[];
  onChange(c: FilterCondition): void;
  onRemove(): void;
  index: number;
}) {
  const {t} = useTranslation('common');
  const prop = properties.find(p => p.apiName === cond.prop);
  const ops: FilterOp[] = prop ? getRenderer(prop.dataType).filterOps : ['eq'];
  const key = prop ? rendererKey(prop.dataType) : 'string';
  const rowLabel = t('filter.condition', {n: index + 1});
  const focusRef = useContext(FocusCtx);
  const propRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (focusRef?.current === cond.id) {
      focusRef.current = null;
      propRef.current?.focus();
    }
  }, [focusRef, cond.id]);
  return (
    <div
      role="group"
      aria-label={rowLabel}
      className="flex flex-wrap items-center gap-2"
    >
      <NativeSelect
        ref={propRef}
        size="sm"
        className="w-40"
        aria-label={t('filter.property')}
        value={cond.prop}
        placeholder={t('filter.chooseProperty')}
        options={properties.map(p => ({
          value: p.apiName,
          label: p.displayName,
        }))}
        onChange={e => {
          const p = properties.find(x => x.apiName === e.target.value);
          const nextOps: FilterOp[] = p
            ? getRenderer(p.dataType).filterOps
            : ['eq'];
          onChange({
            ...cond,
            prop: e.target.value,
            op: nextOps.includes(cond.op) ? cond.op : nextOps[0],
            value: '',
          });
        }}
      />
      <NativeSelect
        size="sm"
        className="w-32"
        aria-label={t('filter.operator')}
        value={cond.op}
        options={ops.map(o => ({value: o, label: t(`filter.ops.${o}`)}))}
        onChange={e => onChange({...cond, op: e.target.value as FilterOp})}
        disabled={!prop}
      />
      {!opIsUnary(cond.op) &&
        (key === 'enum' && cond.op !== 'in' ? (
          <NativeSelect
            size="sm"
            className="w-36"
            aria-label={t('filter.value')}
            value={cond.value}
            placeholder={t('filter.chooseValue')}
            options={(prop?.enumValues ?? []).map(v => ({value: v, label: v}))}
            onChange={e => onChange({...cond, value: e.target.value})}
          />
        ) : key === 'boolean' ? (
          <NativeSelect
            size="sm"
            className="w-24"
            aria-label={t('filter.value')}
            value={cond.value}
            placeholder={t('filter.chooseValue')}
            options={[
              {value: 'true', label: t('bool.true')},
              {value: 'false', label: t('bool.false')},
            ]}
            onChange={e => onChange({...cond, value: e.target.value})}
          />
        ) : (
          <Input
            inputSize="sm"
            className="w-40"
            aria-label={t('filter.value')}
            type={
              (key === 'integer' || key === 'double') && cond.op !== 'in'
                ? 'number'
                : key === 'date'
                  ? 'date'
                  : 'text'
            }
            step="any"
            placeholder={cond.op === 'in' ? t('filter.inHint') : prop?.unit}
            value={cond.value}
            onChange={e => onChange({...cond, value: e.target.value})}
            disabled={!prop}
          />
        ))}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('filter.removeCondition', {n: index + 1})}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

function GroupView({
  group,
  depth,
  maxDepth,
  properties,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  depth: number;
  maxDepth: number;
  properties: RenderProp[];
  onChange(next: FilterGroup): void;
  onRemove?(): void;
}) {
  const {t} = useTranslation('common');
  const first = properties[0];
  const focusRef = useContext(FocusCtx);
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        depth > 0 && 'rounded-[10px] border border-dashed border-line-2 p-2.5',
      )}
      role="group"
      aria-label={depth === 0 ? undefined : t('filter.group')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label={t('filter.combinator')}
          className="flex rounded-[8px] border border-line-2 p-0.5"
        >
          {(['and', 'or'] as const).map(c => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={group.combinator === c}
              onClick={() => onChange({...group, combinator: c})}
              className={cn(
                'rounded-[6px] px-2 py-0.5 text-xs font-semibold',
                group.combinator === c
                  ? 'bg-cyan/15 text-cyan'
                  : 'text-muted hover:text-text',
              )}
            >
              {t(`filter.${c}`)}
            </button>
          ))}
        </div>
        <span className="text-xs text-dim">{t('filter.combinatorHint')}</span>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onRemove}
          >
            <Trash2 aria-hidden />
            {t('filter.removeGroup')}
          </Button>
        )}
      </div>
      {group.items.map((item, i) =>
        item.kind === 'cond' ? (
          <ConditionRow
            key={item.id}
            cond={item}
            index={i}
            properties={properties}
            onChange={c => onChange(replaceItem(group, item.id, c))}
            onRemove={() => onChange(replaceItem(group, item.id, null))}
          />
        ) : (
          <GroupView
            key={item.id}
            group={item}
            depth={depth + 1}
            maxDepth={maxDepth}
            properties={properties}
            onChange={g => onChange(replaceItem(group, item.id, g))}
            onRemove={() => onChange(replaceItem(group, item.id, null))}
          />
        ),
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const c = newCondition(
              first?.apiName ?? '',
              first ? getRenderer(first.dataType).filterOps[0] : 'eq',
            );
            if (focusRef) focusRef.current = c.id;
            onChange({...group, items: [...group.items, c]});
          }}
        >
          <Plus aria-hidden />
          {t('filter.addCondition')}
        </Button>
        {depth + 1 < maxDepth && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({
                ...group,
                items: [
                  ...group.items,
                  newGroup(group.combinator === 'and' ? 'or' : 'and', []),
                ],
              })
            }
          >
            <FolderPlus aria-hidden />
            {t('filter.addGroup')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The builder. */
export function FilterBuilder({
  value,
  onChange,
  properties,
  maxDepth = 2,
  label,
  className,
}: FilterBuilderProps) {
  const focusRef = useRef<string | null>(null);
  return (
    <FocusCtx.Provider value={focusRef}>
      <div className={className} role="group" aria-label={label}>
        <GroupView
          group={value}
          depth={0}
          maxDepth={maxDepth}
          properties={properties}
          onChange={onChange}
        />
      </div>
    </FocusCtx.Provider>
  );
}

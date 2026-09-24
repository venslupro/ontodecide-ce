/**
 * @fileoverview Outcome feedback (1–5 star rating as a native radio group,
 * keyboard accessible, plus an optional comment) and the evaluated outcome
 * (expected vs actual, achievement).
 */

import type {RecommendationDto} from '@ontodecide/decision/contract';
import {feedbackInputSchema} from '@ontodecide/decision/contract';
import {Star} from 'lucide-react';
import {useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../../../shared/api/error_message';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {useOnline} from '../../../shared/lib/hooks';
import {Button} from '../../../shared/ui/button';
import {Field, Textarea} from '../../../shared/ui/input';
import {Progress} from '../../../shared/ui/progress';
import {toast} from '../../../shared/ui/toast';
import {useFeedback} from '../api';

/** Star rating as a radio group (arrow keys move, space selects). */
export function StarRating({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number;
  onChange?(v: number): void;
  disabled?: boolean;
  label: string;
}) {
  const {t} = useTranslation('recommendations');
  const name = useId();
  const readOnly = !onChange;
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled || readOnly}>
      <legend className="mb-1 text-xs font-medium text-muted">{label}</legend>
      <div
        className="flex items-center gap-1"
        role={readOnly ? 'img' : undefined}
        aria-label={readOnly ? t('feedback.stars', {count: value}) : undefined}
      >
        {[1, 2, 3, 4, 5].map(n => (
          <label
            key={n}
            className={cn(
              'relative rounded-md p-0.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan',
              readOnly ? '' : 'cursor-pointer',
            )}
          >
            {!readOnly && (
              <input
                type="radio"
                name={name}
                value={n}
                checked={value === n}
                onChange={() => onChange?.(n)}
                className="sr-only"
                aria-label={t('feedback.stars', {count: n})}
              />
            )}
            <Star
              aria-hidden
              className={cn(
                'size-6 transition-colors',
                n <= value ? 'fill-warn text-warn' : 'text-line-2',
              )}
            />
          </label>
        ))}
        {value > 0 && (
          <span className="ml-2 text-xs text-muted num">
            {t('feedback.stars', {count: value})}
          </span>
        )}
      </div>
    </fieldset>
  );
}

/** Feedback form, or the submitted feedback when present. */
export function FeedbackPanel({rec}: {rec: RecommendationDto}) {
  const {t} = useTranslation('recommendations');
  const online = useOnline();
  const fb = useFeedback(rec.id);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();

  if (rec.feedback) {
    return (
      <div className="flex flex-col gap-2">
        <StarRating value={rec.feedback.rating} label={t('feedback.yours')} />
        {rec.feedback.comment && (
          <p className="text-sm break-words text-text">
            {rec.feedback.comment}
          </p>
        )}
        <p className="text-xs text-good">{t('feedback.thanks')}</p>
      </div>
    );
  }

  const submit = () => {
    const parsed = feedbackInputSchema.safeParse({
      rating,
      comment: comment.trim() || undefined,
    });
    if (!parsed.success) {
      setError(
        rating < 1
          ? t('feedback.ratingRequired')
          : t('feedback.commentTooLong'),
      );
      return;
    }
    setError(undefined);
    fb.mutate(parsed.data, {
      onSuccess: () => toast.success(t('feedback.saved')),
      onError: e => toast.error(t('feedback.failed'), errorMessage(e, t)),
    });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <StarRating
        value={rating}
        onChange={setRating}
        label={t('feedback.rating')}
        disabled={fb.isPending}
      />
      <Field
        label={t('feedback.comment')}
        htmlFor="fb-comment"
        hint={t('feedback.commentHint')}
      >
        <Textarea
          id="fb-comment"
          rows={3}
          maxLength={1000}
          value={comment}
          onChange={e => setComment(e.target.value)}
          disabled={fb.isPending}
        />
      </Field>
      {error && (
        <p role="alert" className="text-xs text-crit">
          {error}
        </p>
      )}
      <div>
        <Button
          type="submit"
          size="sm"
          loading={fb.isPending}
          disabled={!online}
        >
          {t('feedback.submit')}
        </Button>
      </div>
    </form>
  );
}

/** Evaluated outcome: expected vs actual and achievement. */
export function OutcomeView({
  outcome,
}: {
  outcome: NonNullable<RecommendationDto['outcome']>;
}) {
  const {t} = useTranslation('recommendations');
  const tone =
    outcome.achievement >= 0.9
      ? 'good'
      : outcome.achievement >= 0.5
        ? 'warn'
        : 'crit';
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-xs text-muted">{t('outcome.expected')}</dt>
          <dd className="text-lg font-semibold num">
            {fmt.signedPercent(outcome.expected)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('outcome.actual')}</dt>
          <dd className="text-lg font-semibold num">
            {fmt.signedPercent(outcome.actual)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('outcome.achievement')}</dt>
          <dd
            className={cn(
              'text-lg font-semibold num',
              {good: 'text-good', warn: 'text-warn', crit: 'text-crit'}[tone],
            )}
          >
            {fmt.percent(outcome.achievement)}
          </dd>
        </div>
      </dl>
      <Progress
        value={Math.min(1, outcome.achievement)}
        tone={tone}
        label={t('outcome.achievement')}
      />
      <p className="text-xs text-dim">
        {t('outcome.evaluatedAt', {time: fmt.dateTime(outcome.evaluatedAt)})}
      </p>
    </div>
  );
}

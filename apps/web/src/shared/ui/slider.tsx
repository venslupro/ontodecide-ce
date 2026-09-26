/**
 * @fileoverview Slider built on Radix Slider.
 */

import * as S from '@radix-ui/react-slider';
import type {ComponentPropsWithoutRef} from 'react';
import {cn} from '../lib/cn';

/** A single- or multi-thumb slider. */
export function Slider({
  className,
  thumbLabel,
  ...props
}: ComponentPropsWithoutRef<typeof S.Root> & {thumbLabel?: string}) {
  const count = (props.value ?? props.defaultValue ?? [0]).length;
  return (
    <S.Root
      className={cn(
        'relative flex h-5 w-full touch-none items-center select-none',
        className,
      )}
      {...props}
    >
      <S.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-line-2">
        <S.Range className="absolute h-full bg-[linear-gradient(90deg,var(--cyan),var(--blue))]" />
      </S.Track>
      {Array.from({length: count}, (_, i) => (
        <S.Thumb
          key={i}
          aria-label={thumbLabel}
          className="block size-4 rounded-full border-2 border-cyan bg-panel-solid shadow-[var(--glow)] outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        />
      ))}
    </S.Root>
  );
}

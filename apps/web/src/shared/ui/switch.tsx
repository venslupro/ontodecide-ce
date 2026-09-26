/**
 * @fileoverview Toggle switch built on Radix Switch.
 */

import * as S from '@radix-ui/react-switch';
import type {ComponentPropsWithoutRef} from 'react';
import {cn} from '../lib/cn';

/** A switch. */
export function Switch({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-2 bg-panel-2 transition-colors data-[state=checked]:border-cyan/60 data-[state=checked]:bg-cyan/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-muted transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-cyan" />
    </S.Root>
  );
}

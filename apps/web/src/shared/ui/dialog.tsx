/**
 * @fileoverview Modal dialog built on Radix Dialog.
 */

import * as D from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../lib/cn';

/** Dialog root. */
export const Dialog = D.Root;
/** Dialog trigger. */
export const DialogTrigger = D.Trigger;
/** Dialog close. */
export const DialogClose = D.Close;

/** Dialog content with title, optional description and footer. */
export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const {t} = useTranslation('common');
  const width = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size];
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          'glass fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col !bg-panel-solid outline-none',
          width,
          className,
        )}
        {...(description ? {} : {'aria-describedby': undefined})}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <D.Title className="text-base font-semibold text-text">
              {title}
            </D.Title>
            {description && (
              <D.Description className="mt-1 text-sm text-muted">
                {description}
              </D.Description>
            )}
          </div>
          <D.Close
            className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-text"
            aria-label={t('actions.close')}
          >
            <X className="size-4" aria-hidden />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </D.Content>
    </D.Portal>
  );
}

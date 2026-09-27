/**
 * @fileoverview One-time display of the 10 admin recovery codes: download
 * .txt, print, and "I saved them" before continuing. Codes are never
 * stored by the front end.
 */

import {Download, Printer} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {saveText} from '../../../shared/lib/download';
import {Button} from '../../../shared/ui/button';
import {Checkbox, Label} from '../../../shared/ui/input';

/** Recovery codes panel. */
export function RecoveryCodes({
  codes,
  onDone,
}: {
  codes: readonly string[];
  onDone(): void;
}) {
  const {t} = useTranslation('auth');
  const [saved, setSaved] = useState(false);
  const text = `OntoDecide CE — ${t('recovery.fileTitle')}\n\n${codes.join('\n')}\n`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('recovery.intro')}</p>
      <ol
        aria-label={t('recovery.listLabel')}
        className="grid grid-cols-2 gap-2 rounded-[10px] border border-line-2 bg-bg-2/70 p-4 font-mono text-sm text-text"
      >
        {codes.map((c, i) => (
          <li key={c} className="num">
            <span className="mr-2 text-dim">
              {String(i + 1).padStart(2, '0')}
            </span>
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => saveText(text, 'ontodecide-recovery-codes.txt')}>
          <Download aria-hidden />
          {t('recovery.download')}
        </Button>
        <Button onClick={() => window.print()}>
          <Printer aria-hidden />
          {t('recovery.print')}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="recovery-saved"
          checked={saved}
          onCheckedChange={v => setSaved(v === true)}
        />
        <Label htmlFor="recovery-saved" className="text-sm text-text">
          {t('recovery.saved')}
        </Label>
      </div>
      <Button variant="primary" disabled={!saved} onClick={onDone}>
        {t('recovery.continue')}
      </Button>
    </div>
  );
}

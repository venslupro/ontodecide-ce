/**
 * @fileoverview Header tools of the platform page: disposable-domain
 * blocklist editor (GET / PUT /admin/blocked-domains), admin audit log
 * (GET /admin/audit-log, cursor pages, hash chain status `chainOk`) and
 * passkey management (list, add with step-up, delete with step-up; at
 * least 2 must remain).
 */

import {useQueryClient} from '@tanstack/react-query';
import {CheckCircle2, KeyRound, ShieldAlert, Trash2} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  deletePasskey,
  invalidateAdmin,
  putBlockedDomains,
  useAdminPasskeys,
  useAuditLog,
  useBlockedDomains,
} from '../../features/admin/api';
import {AdminConfirmDialog} from '../../features/admin/components/confirm_dialog';
import {
  addAdminPasskey,
  adminPasskeyOptions,
} from '../../features/identity/api';
import {RecoveryCodes} from '../../features/identity/components/recovery_codes';
import {errorMessage} from '../../shared/api/error_message';
import {fmt, shortTid} from '../../shared/lib/format';
import {
  createPasskey,
  PasskeyError,
  requestStepUp,
} from '../../shared/webauthn';
import {Button} from '../../shared/ui/button';
import {Dialog, DialogContent} from '../../shared/ui/dialog';
import {Textarea} from '../../shared/ui/input';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';
import {toast} from '../../shared/ui/toast';

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** Parses the editor text into normalized unique domains. */
export function parseDomains(text: string): {
  domains: string[];
  invalid: string[];
} {
  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const d = raw.trim().toLowerCase();
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) invalid.push(d);
    else seen.add(d);
  }
  return {domains: [...seen].sort(), invalid};
}

function BlockedDomainsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
}) {
  const {t} = useTranslation('admin');
  const qc = useQueryClient();
  const q = useBlockedDomains(open);
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (q.data) setText(q.data.join('\n'));
  }, [q.data]);
  const parsed = parseDomains(text);
  return (
    <>
      <Dialog open={open && !confirm} onOpenChange={onOpenChange}>
        <DialogContent
          size="lg"
          title={t('blocked.title')}
          description={t('blocked.body')}
          footer={
            <Button
              variant="primary"
              disabled={parsed.invalid.length > 0 || q.isLoading}
              onClick={() => setConfirm(true)}
            >
              {t('common:actions.save')}
            </Button>
          }
        >
          <Textarea
            aria-label={t('blocked.title')}
            className="min-h-64 font-mono text-xs"
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <p className="mt-2 text-xs text-muted">
            {t('blocked.count', {count: parsed.domains.length})}
          </p>
          {parsed.invalid.length > 0 && (
            <p role="alert" className="mt-1 text-xs text-crit">
              {t('blocked.invalid', {
                list: parsed.invalid.slice(0, 5).join(', '),
              })}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {confirm && (
        <AdminConfirmDialog
          open
          onOpenChange={v => !v && setConfirm(false)}
          title={t('blocked.confirmTitle')}
          description={t('blocked.count', {count: parsed.domains.length})}
          confirmLabel={t('common:actions.save')}
          onConfirm={w => putBlockedDomains(parsed.domains, w)}
          onDone={() => {
            setConfirm(false);
            onOpenChange(false);
            toast.success(t('done'));
            void invalidateAdmin(qc);
          }}
        />
      )}
    </>
  );
}

function AuditDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
}) {
  const {t} = useTranslation('admin');
  const q = useAuditLog(open);
  const rows = q.data?.pages.flatMap(p => p.items) ?? [];
  const chainOk = q.data?.pages[0]?.chainOk;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        title={t('audit.title')}
        description={
          chainOk === undefined ? undefined : chainOk ? (
            <span className="inline-flex items-center gap-1.5 text-good">
              <CheckCircle2 className="size-4" aria-hidden />
              {t('audit.chainOk')}
            </span>
          ) : (
            <span
              role="alert"
              className="inline-flex items-center gap-1.5 text-crit"
            >
              <ShieldAlert className="size-4" aria-hidden />
              {t('audit.chainBroken')}
            </span>
          )
        }
      >
        <Table aria-label={t('audit.title')}>
          <THead>
            <Tr>
              <Th>{t('audit.at')}</Th>
              <Th>{t('audit.actionCol')}</Th>
              <Th>{t('audit.target')}</Th>
              <Th>{t('reason.label')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map(r => (
              <Tr key={r.id}>
                <Td className="num whitespace-nowrap">{fmt.dateTime(r.at)}</Td>
                <Td>
                  {t(`audit.action.${r.action}`, {defaultValue: r.action})}
                </Td>
                <Td className="font-mono text-xs">
                  {r.targetTenantId ? shortTid(r.targetTenantId) : '—'}
                </Td>
                <Td className="text-muted">{r.reason ?? '—'}</Td>
              </Tr>
            ))}
            {rows.length === 0 && (
              <Tr>
                <Td colSpan={4} className="py-6 text-center text-muted">
                  {q.isLoading ? t('common:state.loading') : t('audit.empty')}
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
        {q.hasNextPage && (
          <div className="mt-3 flex justify-center">
            <Button
              size="sm"
              loading={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {t('common:actions.loadMore')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PasskeysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
}) {
  const {t} = useTranslation('admin');
  const qc = useQueryClient();
  const q = useAdminPasskeys(open);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const list = q.data ?? [];

  const add = async () => {
    setBusy(true);
    try {
      const stepUp = await requestStepUp();
      const cred = await createPasskey(await adminPasskeyOptions());
      const r = await addAdminPasskey(cred, stepUp);
      if (r.recoveryCodes?.length) setCodes(r.recoveryCodes);
      toast.success(t('done'));
      void invalidateAdmin(qc);
    } catch (e) {
      toast.error(
        e instanceof PasskeyError
          ? t('auth:passkeyFailed')
          : errorMessage(e, t),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open && !del} onOpenChange={onOpenChange}>
        <DialogContent
          size="lg"
          title={t('passkeys.title')}
          description={t('passkeys.body')}
          footer={
            !codes && (
              <Button
                variant="primary"
                loading={busy}
                onClick={() => void add()}
              >
                <KeyRound aria-hidden />
                {t('passkeys.add')}
              </Button>
            )
          }
        >
          {codes ? (
            <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
          ) : (
            <ul className="divide-y divide-line">
              {list.map(p => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <KeyRound className="size-4 text-violet" aria-hidden />
                  <span className="flex-1 text-sm text-text">
                    {p.label ?? t('passkeys.unnamed')}
                    <span className="ml-2 text-xs text-muted">
                      {t('passkeys.created', {time: fmt.dateTime(p.createdAt)})}
                      {p.lastUsedAt &&
                        ` · ${t('passkeys.lastUsed', {time: fmt.dateTime(p.lastUsedAt)})}`}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={list.length <= 2}
                    title={list.length <= 2 ? t('passkeys.minTwo') : undefined}
                    aria-label={`${t('passkeys.delete')} ${p.label ?? p.id}`}
                    onClick={() => setDel(p.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
              {list.length === 0 && (
                <li className="py-4 text-sm text-muted">
                  {q.isLoading
                    ? t('common:state.loading')
                    : t('passkeys.empty')}
                </li>
              )}
            </ul>
          )}
          {!codes && list.length <= 2 && list.length > 0 && (
            <p className="mt-3 text-xs text-muted">{t('passkeys.minTwo')}</p>
          )}
        </DialogContent>
      </Dialog>
      {del && (
        <AdminConfirmDialog
          open
          onOpenChange={v => !v && setDel(null)}
          highRisk
          danger
          title={t('passkeys.deleteTitle')}
          confirmLabel={t('passkeys.delete')}
          onConfirm={w => deletePasskey(del, w)}
          onDone={() => {
            setDel(null);
            toast.success(t('done'));
            void invalidateAdmin(qc);
          }}
        />
      )}
    </>
  );
}

/** Header buttons + dialogs. */
export function AdminTools() {
  const {t} = useTranslation('admin');
  const [open, setOpen] = useState<'blocked' | 'audit' | 'passkeys' | null>(
    null,
  );
  const set = (k: typeof open) => (v: boolean) => setOpen(v ? k : null);
  return (
    <>
      <Button onClick={() => setOpen('blocked')}>{t('blocked.button')}</Button>
      <Button onClick={() => setOpen('audit')}>{t('audit.button')}</Button>
      <Button onClick={() => setOpen('passkeys')}>
        {t('passkeys.button')}
      </Button>
      <BlockedDomainsDialog
        open={open === 'blocked'}
        onOpenChange={set('blocked')}
      />
      <AuditDialog open={open === 'audit'} onOpenChange={set('audit')} />
      <PasskeysDialog
        open={open === 'passkeys'}
        onOpenChange={set('passkeys')}
      />
    </>
  );
}

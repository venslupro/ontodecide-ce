/**
 * @fileoverview Transactional e-mail templates in zh-CN and en-US
 * (详细设计 6.11.6). Dark "tech" HTML with inline styles (see the
 * c10_email mockups) plus a plain-text part. Templates contain no tracking
 * pixels and no redirecting links.
 */

import {ARCHIVE_FILES, type Locale} from '@ontodecide/shared-kernel';

/** Template ids. */
export type TemplateId =
  | 'code_signup'
  | 'code_login'
  | 'code_terminate'
  | 'trial_reminder'
  | 'archive_ready'
  | 'account_deleted'
  | 'admin_new_device'
  | 'admin_pending_change';

/** Data of each template. */
export interface TemplateData {
  code_signup: {code: string};
  code_login: {code: string};
  code_terminate: {code: string};
  trial_reminder: {expiresAt: number; timeZone: string; appOrigin: string};
  archive_ready: {
    url: string;
    deleteUrl: string;
    sizeBytes: number;
    sha256: string;
    expiresAt: number;
    timeZone: string;
  };
  account_deleted: {reason: 'empty' | 'admin'};
  admin_new_device: {
    at: number;
    timeZone: string;
    client: string | null;
    method: 'passkey' | 'recovery';
  };
  admin_pending_change: {
    kind: 'email' | 'passkey_reset';
    effectiveAt: number;
    timeZone: string;
  };
}

/** A rendered message body. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  bg: '#0a0f1c',
  card: '#0f172a',
  border: '#1e2a44',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#22d3ee',
  warnBorder: '#a16207',
  warnBg: '#1c1917',
};

/** Escapes text for HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone}).format(0);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function offsetLabel(ms: number, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(ms)
    .find(p => p.type === 'timeZoneName')?.value;
  const label = (part ?? 'GMT').replace('GMT', 'UTC');
  return label === 'UTC+0' ? 'UTC' : label;
}

/**
 * Formats an instant in the user's time zone: `2026-10-07 14:20（北京时间）`
 * or `Oct 7, 2026 14:20 (UTC+8)`.
 */
export function formatInstant(
  ms: number,
  locale: Locale,
  timeZone: string,
): string {
  const tz = safeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map(p => [p.type, p.value]),
  ) as Record<string, string>;
  const time = `${parts.hour}:${parts.minute}`;
  if (locale === 'zh-CN') {
    const zone = tz === 'Asia/Shanghai' ? '北京时间' : offsetLabel(ms, tz);
    return `${parts.year}-${parts.month}-${parts.day} ${time}（${zone}）`;
  }
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(ms);
  return `${date} ${time} (${offsetLabel(ms, tz)})`;
}

/** Formats a size in KB / MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shortens a SHA-256 for display (`9f2c…a41e`). */
export function shortHash(sha256: string): string {
  return sha256.length > 12
    ? `${sha256.slice(0, 4)}…${sha256.slice(-4)}`
    : sha256;
}

function brand(locale: Locale): string {
  const edition = locale === 'zh-CN' ? '社区版' : 'COMMUNITY EDITION';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0"><tr>
<td style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#22d3ee);text-align:center;vertical-align:middle">
<div style="width:18px;height:18px;margin:11px auto;border-radius:5px;background:${C.bg}"></div></td>
<td style="padding-left:12px"><div style="font-size:18px;font-weight:700;color:${C.text}">OntoDecide</div>
<div style="font-size:11px;letter-spacing:2px;color:${C.muted}">${edition}</div></td></tr></table>`;
}

function layout(locale: Locale, title: string, body: string): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.border};border-radius:14px"><tr><td style="padding:32px">
${brand(locale)}
<h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.3;color:${C.text}">${escapeHtml(title)}</h1>
${body}
</td></tr></table></td></tr></table></body></html>`;
}

function para(s: string): string {
  return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:${C.muted}">${s}</p>`;
}

function codeBox(code: string): string {
  return `<div style="margin:8px 0 20px 0;padding:16px;border:1px solid ${C.border};border-radius:10px;text-align:center;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;letter-spacing:10px;color:${C.accent}">${escapeHtml(code)}</div>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0"><tr><td style="border-radius:10px;background:linear-gradient(90deg,#22d3ee,#3b82f6)">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#0a0f1c;text-decoration:none">&#8595;&nbsp; ${escapeHtml(label)}</a></td></tr></table>`;
}

function infoTable(rows: [string, string][]): string {
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 12px;border-bottom:1px solid ${C.border};font-size:14px;color:${C.muted};white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:10px 12px;border-bottom:1px solid ${C.border};font-size:14px;color:${C.text}">${v}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0">${tr}</table>`;
}

function warning(s: string): string {
  return `<div style="margin:0 0 20px 0;padding:14px 18px;border:1px solid ${C.warnBorder};border-radius:10px;background:${C.warnBg};font-size:14px;line-height:1.6;color:${C.text}">${s}</div>`;
}

function footer(s: string): string {
  return `<p style="margin:0;font-size:13px;line-height:1.6;color:${C.muted}">${s}</p>`;
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${C.accent};text-decoration:none">${escapeHtml(label)}</a>`;
}

type Renderer<T extends TemplateId> = (
  d: TemplateData[T],
  locale: Locale,
) => RenderedEmail;

function codeTemplate(
  zhTitle: string,
  enTitle: string,
  zhIntro: string,
  enIntro: string,
): (d: {code: string}, locale: Locale) => RenderedEmail {
  return ({code}, locale) => {
    const zh = locale === 'zh-CN';
    const title = zh ? zhTitle : enTitle;
    const intro = zh ? zhIntro : enIntro;
    const validity = zh
      ? '验证码 10 分钟内有效，只能使用一次。如果这不是你本人的操作，请忽略本邮件。'
      : 'The code is valid for 10 minutes and can be used once. If you did not request it, ignore this e-mail.';
    return {
      subject: zh
        ? `${code} 是你的 OntoDecide ${zhTitle}`
        : `${code} is your OntoDecide ${enTitle.toLowerCase()}`,
      html: layout(
        locale,
        title,
        para(escapeHtml(intro)) + codeBox(code) + footer(escapeHtml(validity)),
      ),
      text: `${title}\n\n${intro}\n\n    ${code}\n\n${validity}\n`,
    };
  };
}

const RENDERERS: {[K in TemplateId]: Renderer<K>} = {
  code_signup: codeTemplate(
    '注册验证码',
    'Sign-up code',
    '你正在注册 OntoDecide 社区版。输入下面的验证码即可开始 72 小时试用：',
    'You are signing up for OntoDecide Community Edition. Enter this code to start your 72-hour trial:',
  ),
  code_login: codeTemplate(
    '登录验证码',
    'Sign-in code',
    '你正在登录 OntoDecide。输入下面的验证码完成登录：',
    'You are signing in to OntoDecide. Enter this code to continue:',
  ),
  code_terminate: codeTemplate(
    '结束试用确认码',
    'Trial termination code',
    '你正在提前结束 OntoDecide 试用。确认后工作区数据将打包归档并删除账户。输入下面的验证码确认：',
    'You are ending your OntoDecide trial early. Your data will be archived and your account deleted. Enter this code to confirm:',
  ),
  trial_reminder: ({expiresAt, timeZone, appOrigin}, locale) => {
    const zh = locale === 'zh-CN';
    const when = formatInstant(expiresAt, locale, timeZone);
    const title = zh
      ? '你的试用将在 24 小时后结束'
      : 'Your trial ends in 24 hours';
    const p1 = zh
      ? `试用将于 ${when} 结束。结束后，我们会把工作区数据打包为 ZIP，并向本邮箱发送一次 7 天有效的下载链接，随后删除全部业务数据与账户信息（包括邮箱）。`
      : `Your trial ends on ${when}. We will then pack your workspace data into a ZIP and send a download link, valid for 7 days, to this address once, and delete all business data and account information, including this e-mail address.`;
    const p2 = zh
      ? '下载链接只会发送一次，账户删除后无法重新发送。建议你现在就在「账户」页面自行导出数据。'
      : 'The link is sent only once and cannot be re-sent after the account is deleted. We recommend exporting your data yourself now from the Account page.';
    const cta = zh ? '打开 OntoDecide' : 'Open OntoDecide';
    return {
      subject: zh
        ? '你的 OntoDecide 试用即将结束'
        : 'Your OntoDecide trial is ending soon',
      html: layout(
        locale,
        title,
        para(escapeHtml(p1)) +
          warning(escapeHtml(p2)) +
          button(`${appOrigin}/account`, cta),
      ),
      text: `${title}\n\n${p1}\n\n${p2}\n\n${cta}: ${appOrigin}/account\n`,
    };
  },
  archive_ready: (d, locale) => {
    const zh = locale === 'zh-CN';
    const size = formatSize(d.sizeBytes);
    const until = formatInstant(d.expiresAt, locale, d.timeZone);
    const files = [...ARCHIVE_FILES, 'manifest.json', 'README.txt'].join(' · ');
    const title = zh ? '你的试用已结束' : 'Your trial has ended';
    const intro = zh
      ? '我们已把工作区数据打包为 ZIP。点击下方按钮直接下载，无需登录。你的账户信息（包括本邮箱地址）已从系统中删除。'
      : 'We packed your workspace data into a ZIP. Click the button below to download it directly, no sign-in needed. Your account information, including this email address, has been deleted from our system.';
    const btn = zh
      ? `下载数据（ZIP，${size}）`
      : `Download data (ZIP, ${size})`;
    const warn = zh
      ? '请勿转发此邮件：任何持有链接的人都能下载。本邮件只发送一次，系统无法重新发送。'
      : 'Do not forward this email: anyone with the link can download the file. It is sent only once and cannot be re-sent.';
    const del = zh ? '立即删除归档' : 'Delete the archive now';
    const foot = zh
      ? `不需要这些数据？${link(d.deleteUrl, del)} · 到期后 ZIP 将被永久删除。`
      : `Don’t need the data? ${link(d.deleteUrl, del)} · The ZIP is permanently deleted when the link expires.`;
    const rows: [string, string][] = [
      [zh ? '链接有效期' : 'Link valid until', escapeHtml(until)],
      [zh ? '包含' : 'Contains', escapeHtml(files)],
      [
        'SHA-256',
        `<span title="${escapeHtml(d.sha256)}" style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:12px;color:${C.muted}">${escapeHtml(shortHash(d.sha256))}</span><br><span style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:10px;color:${C.border};word-break:break-all">${escapeHtml(d.sha256)}</span>`,
      ],
    ];
    return {
      subject: zh
        ? '你的 OntoDecide 试用已结束 · 数据下载链接（7 天内有效）'
        : 'Your OntoDecide trial has ended · data download link (valid 7 days)',
      html: layout(
        locale,
        title,
        para(escapeHtml(intro)) +
          button(d.url, btn) +
          infoTable(rows) +
          warning(escapeHtml(warn)) +
          footer(foot),
      ),
      text: [
        title,
        '',
        intro,
        '',
        `${btn}: ${d.url}`,
        '',
        `${zh ? '链接有效期' : 'Link valid until'}: ${until}`,
        `${zh ? '包含' : 'Contains'}: ${files}`,
        `SHA-256: ${d.sha256}`,
        '',
        warn,
        '',
        `${del}: ${d.deleteUrl}`,
        '',
      ].join('\n'),
    };
  },
  account_deleted: ({reason}, locale) => {
    const zh = locale === 'zh-CN';
    const title = zh ? '你的账户已删除' : 'Your account has been deleted';
    const body =
      reason === 'empty'
        ? zh
          ? '你的 OntoDecide 试用已结束。工作区中没有导入数据，也没有修改本体，因此没有生成归档。你的账户信息（包括本邮箱地址）已从系统中删除。'
          : 'Your OntoDecide trial has ended. The workspace had no imported data and no ontology changes, so no archive was created. Your account information, including this email address, has been deleted.'
        : zh
          ? '平台管理员已删除你的 OntoDecide 账户，工作区数据未归档。你的账户信息（包括本邮箱地址）已从系统中删除。'
          : 'The platform administrator deleted your OntoDecide account; the workspace data was not archived. Your account information, including this email address, has been deleted.';
    const foot = zh
      ? '这是本系统发往该地址的最后一封邮件。'
      : 'This is the last e-mail we send to this address.';
    return {
      subject: zh
        ? '你的 OntoDecide 账户已删除'
        : 'Your OntoDecide account has been deleted',
      html: layout(
        locale,
        title,
        para(escapeHtml(body)) + footer(escapeHtml(foot)),
      ),
      text: `${title}\n\n${body}\n\n${foot}\n`,
    };
  },
  admin_new_device: ({at, timeZone, client, method}, locale) => {
    const zh = locale === 'zh-CN';
    const title = zh
      ? '管理员账户在新设备上登录'
      : 'New sign-in to the admin account';
    const how =
      method === 'recovery' ? (zh ? '恢复码' : 'a recovery code') : 'Passkey';
    const body = zh
      ? `管理员账户刚刚使用 ${how} 在新设备上登录。如果不是你本人，请立即吊销会话并联系运维。`
      : `The admin account just signed in on a new device using ${how}. If this was not you, revoke the sessions and contact operations at once.`;
    const rows: [string, string][] = [
      [zh ? '时间' : 'Time', escapeHtml(formatInstant(at, locale, timeZone))],
      [zh ? '设备' : 'Device', escapeHtml(client ?? (zh ? '未知' : 'unknown'))],
    ];
    return {
      subject: zh
        ? 'OntoDecide 管理员新设备登录提醒'
        : 'OntoDecide admin sign-in from a new device',
      html: layout(locale, title, para(escapeHtml(body)) + infoTable(rows)),
      text: `${title}\n\n${body}\n\n${rows.map(r => `${r[0]}: ${r[1]}`).join('\n')}\n`,
    };
  },
  admin_pending_change: ({kind, effectiveAt, timeZone}, locale) => {
    const zh = locale === 'zh-CN';
    const what =
      kind === 'email'
        ? zh
          ? '更换管理员邮箱'
          : 'change the admin e-mail address'
        : zh
          ? '重置管理员 Passkey'
          : 'reset the admin passkeys';
    const title = zh
      ? '管理员账户受控变更通知'
      : 'Admin account change scheduled';
    const when = formatInstant(effectiveAt, locale, timeZone);
    const body = zh
      ? `运维已提交「${what}」的请求，将于 ${when} 生效。如果这不是预期的变更，请在生效前联系运维取消。`
      : `Operations requested to ${what}. The change takes effect on ${when}. If you did not expect this, contact operations before then to cancel it.`;
    return {
      subject: zh
        ? 'OntoDecide 管理员账户变更通知'
        : 'OntoDecide admin account change notice',
      html: layout(locale, title, warning(escapeHtml(body))),
      text: `${title}\n\n${body}\n`,
    };
  },
};

/** Renders a template. */
export function renderEmail<T extends TemplateId>(
  template: T,
  locale: Locale,
  data: TemplateData[T],
): RenderedEmail {
  return (RENDERERS[template] as Renderer<T>)(data, locale);
}

/** Whether a template carries a one-time code (priority mail). */
export function isCodeTemplate(t: TemplateId): boolean {
  return t === 'code_signup' || t === 'code_login' || t === 'code_terminate';
}

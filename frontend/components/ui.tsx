'use client';
import {useI18n, translate as t, intlLocale, localizedError} from '@/lib/i18n';
import { createContext, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { CloudFile } from '@/lib/types';
import { mediaUrl } from '@/lib/api';
const paths: Record<string, string> = { folder: 'M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5', heart: 'm12 21-8.7-8.5a5.6 5.6 0 0 1 7.9-7.9l.8.9.8-.9a5.6 5.6 0 0 1 7.9 7.9Z', plus: 'M12 4v16M4 12h16', close: 'm6 6 12 12M6 18 18 6', list: 'M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1', grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z', cloud: 'M7 18h11a4 4 0 0 0 .4-8 6.5 6.5 0 0 0-12.6-1A4.6 4.6 0 0 0 7 18Z', upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5', trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7', restore: 'M3 10a9 9 0 1 1 0 5M3 4v6h6m3-3v5l3 2', calendar: 'M7 2v6m10-6v6M3 11h18M3 5h18v16H3Z', gift: 'M3 8h18v4H3ZM5 12v9h14v-9M12 8v13m0-13H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z', lock: 'M4 10h16v12H4ZM8 10V6a4 4 0 0 1 8 0v4m-4 5v3', check: 'm5 12 4 4L19 6', search: 'M16 16l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', mail: 'M3 5h18v14H3ZM3 5l9 8 9-8', reply: 'M3 7h18v12H8l-5 3Z', chevron: 'm9 5 7 7-7 7', menu: 'M4 6h16M4 12h16M4 18h16', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0', clock: 'M12 7v5l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', activity: 'M3 12h4l3-8 4 16 3-8h4', send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13', info: 'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' };
export function Icon({ name }: {
    name: string;
}) { const { t } = useI18n(); return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.file}/></svg>; }
export const NoticeContext = createContext<(message: string, error?: boolean) => void>(() => { });
export const useNotice = () => useContext(NoticeContext);
export function Avatar({name,url,className=''}:{name:string;url?:string|null;className?:string}){const[broken,setBroken]=useState(false);useEffect(()=>setBroken(false),[url]);return <span className={'wp-avatar '+className} role="img" aria-label={name}>{url&&!broken?<img src={url} alt="" width={80} height={80} onError={()=>setBroken(true)}/>:name.trim().slice(0,1)||'♡'}</span>;}
export function Button({ icon, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: string;
}) { const { t } = useI18n(); return <button type="button" className={'wp-button ' + className} {...props}>{icon && <Icon name={icon}/>} {children}</button>; }
export function ActionButton({ action, ...props }: Omit<React.ComponentProps<typeof Button>, 'onClick'> & {
    action: () => Promise<unknown>;
}) { const { t } = useI18n(); const [busy, setBusy] = useState(false); const notice = useNotice(); return <Button {...props} disabled={busy || props.disabled} aria-busy={busy} onClick={async () => { setBusy(true); try {
    await action();
}
catch (e) {
    notice(errorMessage(e), true);
}
finally {
    setBusy(false);
} }}/>; }
export const errorMessage = (error: unknown) => error instanceof Error ? localizedError(error.message) : t("Не удалось выполнить действие. Попробуйте снова.");
export function useAction() { const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const notice = useNotice(); return { busy, error, run: async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try {
        await action();
    }
    catch (e) {
        const message = errorMessage(e);
        setError(message);
        notice(message, true);
    }
    finally {
        setBusy(false);
    } } }; }
export function Heading({ title, subtitle, children }: {
    title: string;
    subtitle?: string;
    children?: ReactNode;
}) { const { t } = useI18n(); return <header className="wp-page-heading"><div><h1 tabIndex={-1}>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="wp-heading-actions">{children}</div></header>; }
export function Empty({ title, children }: {
    title: string;
    children: ReactNode;
}) { const { t } = useI18n(); return <div className="wp-empty"><Icon name="folder"/><h2>{title}</h2><div>{children}</div></div>; }
export function Loading() { const { t } = useI18n(); return <div className="lc-skeleton" role="status" aria-label={t("Загрузка")}><span /><span /><span /></div>; }
export function ErrorBox({ error, retry }: {
    error: unknown;
    retry?: () => void;
}) { const { t } = useI18n(); return <div className="lc-error" role="alert"><p>{errorMessage(error)}</p>{retry && <Button onClick={retry}>{t("Повторить")}</Button>}</div>; }
export function Dialog({ title, onClose, children, wide = false }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    wide?: boolean;
}) { const { t } = useI18n(); const ref = useRef<HTMLDialogElement>(null); const closeRef = useRef(onClose); closeRef.current = onClose; useEffect(() => { const previous = document.activeElement as HTMLElement | null; const d = ref.current; d?.showModal(); return () => { d?.close(); if (previous?.isConnected)
    previous.focus({ preventScroll: true }); }; }, []); return <dialog ref={ref} className={'wp-dialog ' + (wide ? 'wp-preview-dialog' : '')} onCancel={e => { e.preventDefault(); closeRef.current(); }} onClick={e => { if (e.target === e.currentTarget) {
    const b = e.currentTarget.getBoundingClientRect();
    if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom)
        closeRef.current();
} }} aria-labelledby="lc-dialog-title"><header className="wp-dialog-heading"><h2 id="lc-dialog-title">{title}</h2><Button className="wp-icon-button" icon="close" aria-label={t("Закрыть окно")} onClick={onClose}/></header>{children}</dialog>; }
export function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) { const { t } = useI18n(); return <label className="wp-field"><span>{label}</span>{children}</label>; }
export function Footer({ busy, label, onCancel }: {
    busy: boolean;
    label: string;
    onCancel: () => void;
}) { const { t } = useI18n(); return <div className="wp-dialog-footer"><Button onClick={onCancel}>{t("Отмена")}</Button><Button type="submit" className="wp-primary" disabled={busy} aria-busy={busy}>{busy ? t("Сохраняем…") : label}</Button></div>; }
export function Thumb({ file }: {
    file: CloudFile;
}) { const { t } = useI18n(); const isImage = file.mimeType.startsWith('image/'); return isImage || file.thumbnailUrl ? <img src={file.thumbnailUrl || mediaUrl(file)} width={640} height={420} alt={file.name} className="wp-file-image" loading="lazy"/> : <div className={'wp-file-glyph wp-kind-' + (file.mimeType.includes('pdf') ? 'pdf' : 'doc')}><Icon name="file"/><span>{extension(file.name)}</span></div>; }
export function Preview({ file, onClose }: {
    file: CloudFile;
    onClose: () => void;
}) { const { t } = useI18n(); const contentRef = useRef<HTMLDivElement>(null); useEffect(() => { const media = contentRef.current?.querySelectorAll<HTMLMediaElement>('video,audio'); return () => { media?.forEach(element => { element.pause(); element.removeAttribute('src'); element.load(); }); }; }, [file.id]); const url = mediaUrl(file); const type = file.mimeType; return <Dialog title={file.name} onClose={onClose} wide><div ref={contentRef} className="wp-preview-content">{type.startsWith('image/') ? <img src={url} alt={file.name} className="lc-full-image"/> : type.startsWith('video/') ? <video controls autoPlay={false} src={url} className="lc-media"/> : type.startsWith('audio/') ? <audio controls src={url} className="lc-media"/> : type === 'application/pdf' ? <iframe src={url} title={file.name} className="lc-pdf"/> : <div className="wp-empty"><Icon name="file"/><p>{t("Предпросмотр этого формата недоступен. Скачайте файл, чтобы открыть его.")}</p></div>}</div><footer className="wp-preview-footer"><span>{bytes(file.size)} · {file.ownerName}</span><a href={url} download={file.name} className="wp-button wp-primary">{t("Скачать оригинал")}</a></footer></Dialog>; }
export const extension = (name: string) => name.split('.').at(-1)?.toUpperCase() || t("ФАЙЛ");

export function noun(count: number, forms: [
    string,
    string,
    string
]) { return forms[({ one: 0, few: 1, many: 2, zero: 2, two: 1, other: 2 })[new Intl.PluralRules(intlLocale()).select(count)]]; }
export function bytes(size: number) { return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(size >= 1073741824 ? size / 1073741824 : size >= 1048576 ? size / 1048576 : size / 1024) + (size >= 1073741824 ? t(" ГБ") : size >= 1048576 ? t(" МБ") : t(" КБ")); }
export function date(value?: string | null, time = false) { if (!value)
    return t("Без срока"); return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value.length === 10 ? value + 'T12:00:00' : value)); }
export const priorityLabels = { low: 'Низкий', normal: 'Обычный', high: 'Высокий' };
export function burst(element: HTMLElement) { if (document.body.classList.contains('motion-paused') || matchMedia('(prefers-reduced-motion: reduce)').matches)
    return; const r = element.getBoundingClientRect(); for (let i = 0; i < 7; i++) {
    const h = document.createElement('span');
    h.className = 'wp-heart-burst';
    h.setAttribute('aria-hidden', 'true');
    h.textContent = i % 2 ? '♡' : '♥';
    h.style.left = `${r.left + r.width / 2}px`;
    h.style.top = `${r.top}px`;
    h.style.setProperty('--drift', `${(i - 3) * 19}px`);
    h.style.setProperty('--turn', `${(i - 3) * 15}deg`);
    document.body.append(h);
    setTimeout(() => h.remove(), 1000);
} }

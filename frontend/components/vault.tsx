'use client';
import {useI18n, translate as t} from '@/lib/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { SWRConfig } from 'swr';
import { api } from '@/lib/api';
import type { CloudFile, VaultStatus } from '@/lib/types';
import Cloud from './cloud';
import { Button, ErrorBox, Field, Heading, Icon, Loading, Preview, useAction, useNotice } from './ui';
export default function Vault({ desk, onDesk }: {
    desk: boolean;
    onDesk: (v: boolean) => void;
}) {
    const { t } = useI18n();
    const { data: status, error, mutate } = useSWR<VaultStatus>('/vault/status', api, { revalidateOnFocus: true, refreshInterval: 0 });
    const [closed, setClosed] = useState(true);
    const [enrollment, setEnrollment] = useState<{
        secret: string;
        otpauthUri: string;
        qr: string;
    } | null>(null);
    const [codes, setCodes] = useState<string[] | null>(null);
    const [recover, setRecover] = useState(false);
    const [recovered, setRecovered] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [folder, setFolder] = useState<string | null>(null);
    const [preview, setPreview] = useState<CloudFile | null>(null);
    const action = useAction();
    const notice = useNotice();
    const live = Boolean(status?.unlocked && !closed);
    const lock = useCallback(() => { setClosed(true); setPreview(null); setEnrollment(null); setCodes(null); void api('/vault/lock', 'POST').then(() => mutate()).catch(() => { }); }, [mutate]);
    const liveRef = useRef(live);
    liveRef.current = live;
    useEffect(() => { const hidden = () => { if (document.hidden) {
        setEnrollment(null);
        setCodes(null);
        setPreview(null);
        if (liveRef.current)
            lock();
    } }; const expired = () => lock(); document.addEventListener('visibilitychange', hidden); window.addEventListener('lovecloud:vault-locked', expired); return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('lovecloud:vault-locked', expired); if (liveRef.current)
        void api('/vault/lock', 'POST').catch(() => { }); }; }, [lock]);
    useEffect(() => { if (!live || !status?.expiresAt)
        return; const tick = () => { const left = Math.max(0, Math.ceil((Date.parse(status.expiresAt!) - Date.now()) / 1000)); setSeconds(left); if (!left)
        lock(); }; tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [live, status?.expiresAt, lock]);
    const codeField = <Field label={t("Код из 6 цифр")}><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000"/></Field>;
    if (!status && !error)
        return <Loading />;
    return <><Heading title={t("Личное")} subtitle={t("Общий раздел пары · ваш дополнительный вход")}><span className="wp-badge">TOTP</span>{live && <><span className="wp-badge" role="timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span><Button icon="lock" onClick={lock}>{t("Закрыть раздел")}</Button></>}</Heading>{error && <ErrorBox error={error} retry={() => void mutate()}/>} {codes ? <section className="wp-memory lc-recovery"><h2>{t("Сохраните коды восстановления")}</h2><p>{t("Они показываются один раз. Каждый код можно использовать только один раз вместе с паролем для восстановления TOTP. Сохраните их в безопасном месте вне LoveCloud.")}</p><ul>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><Button className="wp-primary" onClick={() => { setCodes(null); setEnrollment(null); void mutate(); }}>{t("Я сохранил(а) коды")}</Button><p className="wp-footnote">{t("Подтверждённый код TOTP уже использован. Для открытия раздела дождитесь следующего кода приложения.")}</p></section> : live ? <SWRConfig key={status?.expiresAt} value={{ provider: () => new Map(), revalidateOnFocus: false }}><Cloud view="cloud" folderId={folder} query="" space="vault" desk={desk} onDesk={onDesk} onFolder={setFolder} onPreview={setPreview} onSelect={() => { }}/>{preview && <Preview file={preview} onClose={() => setPreview(null)}/>}</SWRConfig> : <section className="wp-vault-gate"><div className="wp-lock-art"><Icon name="lock"/><span aria-hidden="true">♡</span></div><div>{enrollment ? <><h2>{t("Привяжите приложение")}</h2><p>{t("Отсканируйте QR в Google Authenticator или другом TOTP-приложении. QR сформирован на этом устройстве.")}</p><img className="lc-qr" src={enrollment.qr} alt={t("QR-код привязки TOTP")} width={224} height={224}/><details><summary>{t("Ручной ключ")}</summary><code className="lc-secret">{enrollment.secret}</code></details><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action.run(async () => { const result = await api<{
        recoveryCodes: string[];
    }>('/vault/enrollment/confirm', 'POST', { code: f.get('code') }); setCodes(result.recoveryCodes); setEnrollment(null); await mutate(); notice(t("TOTP привязан")); }); }}>{codeField}<Button type="submit" className="wp-primary" disabled={action.busy}>{t("Подтвердить привязку")}</Button></form></> : recover ? <><h2>{t("Восстановление TOTP")}</h2><p>{t("Нужны ваш пароль и один неиспользованный код восстановления. Это разрешит новую привязку, а не просмотр файлов.")}</p><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action.run(async () => { await api('/vault/recover', 'POST', { password: f.get('password'), recoveryCode: f.get('recoveryCode') }); setRecover(false); setRecovered(true); await mutate(); notice(t("Код принят. Привяжите новое TOTP-приложение.")); }); }}><Field label={t("Ваш пароль")}><input name="password" type="password" autoComplete="current-password" required/></Field><Field label={t("Код восстановления")}><input name="recoveryCode" autoComplete="off" required/></Field><Button type="submit" className="wp-primary" disabled={action.busy}>{t("Начать перепривязку")}</Button></form><Button className="wp-text" onClick={() => setRecover(false)}>{t("Вернуться ко входу")}</Button></> : status?.enrolled && !recovered ? <><h2>{t("Ещё один маленький ключ")}</h2><p>{t("Введите код из вашего TOTP-приложения. Доступ открывается на 10 минут.")}</p><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action.run(async () => { await api('/vault/unlock', 'POST', { code: f.get('code') }); if (document.hidden) {
        await api('/vault/lock', 'POST');
        setClosed(true);
    }
    else
        setClosed(false); await mutate(); notice(t("Дополнительный вход проверен")); }); }}>{codeField}<Button type="submit" className="wp-primary" disabled={action.busy}>{t("Открыть раздел")}</Button></form><Button className="wp-text" onClick={() => setRecover(true)}>{t("Потерялось TOTP-приложение")}</Button></> : <><h2>{t("Дополнительный вход")}</h2><p>{t("Привяжите Google Authenticator или совместимое TOTP-приложение. Это не вход через Google.")}</p><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action.run(async () => { const result = await api<{
        secret: string;
        otpauthUri: string;
    }>('/vault/enrollment', 'POST', { password: f.get('password') }); const QRCode = await import('qrcode'); const qr = await QRCode.toDataURL(result.otpauthUri, { width: 224, margin: 2, errorCorrectionLevel: 'M' }); if (document.hidden)
        throw new Error(t("Вернитесь в открытую вкладку и начните привязку снова.")); setEnrollment({ ...result, qr }); }); }}><Field label={t("Подтвердите ваш пароль")}><input name="password" type="password" autoComplete="current-password" required/></Field><Button type="submit" className="wp-primary" disabled={action.busy}>{t("Получить QR-код")}</Button></form></>}{action.error && <ErrorBox error={new Error(action.error)}/>}<p className="wp-footnote">{t("При уходе со страницы или скрытии вкладки раздел закроется. Шифрование сервера не является E2EE и не защищает от оператора хоста.")}</p></div></section>}</>;
}

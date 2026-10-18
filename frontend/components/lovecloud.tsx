'use client';
import {useI18n, translate as t} from '@/lib/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import useSWR, { SWRConfig, useSWRConfig } from 'swr';
import { api, ApiError, resetCsrf } from '@/lib/api';
import type { Activity, CloudFile, Folder, Session, StorageInfo } from '@/lib/types';
import { Login, ChangePassword, Admin } from './auth';
import Cloud, { Albums, folderPath } from './cloud';
import Social from './social';
import Planner, { type Member } from './planner';
import Wishes from './wishes';
import Settings from './settings';
import SetupWelcome from './setup-welcome';
import {activityText} from '@/lib/activity-text';
import type {SetupStatus} from '@/lib/setup-api';
import { ActionButton, Button, Empty, ErrorBox, Heading, Icon, Loading, NoticeContext, Preview, Thumb, Avatar, bytes, date, noun } from './ui';
const Vault = dynamic(() => import('./vault'), { loading: () => <Loading /> });
const nav = [['cloud', 'cloud', 'Наше облако'], ['recent', 'clock', 'Недавние'], ['favorites', 'heart', 'Избранное'], ['albums', 'file', 'Альбомы'], ['feed', 'heart', 'Воспоминания'], ['messages', 'mail', 'Послания'], ['planner', 'calendar', 'Планнер'], ['wishes', 'gift', 'Вишлисты'], ['vault', 'lock', 'Личное'], ['activity', 'activity', 'Активность'], ['trash', 'trash', 'Корзина'], ['settings','info','Настройки']];
type Route = {
    view: string;
    folderId: string | null;
    query: string;
};
function readRoute(): Route { const [v, q = ''] = location.hash.slice(1).split('?'); const p = new URLSearchParams(q); return { view: nav.some(n => n[0] === v) ? v : 'cloud', folderId: p.get('folder'), query: p.get('q') || '' }; }
export default function LoveCloud(){
 const {t,apply}=useI18n();
 const [session,setSession]=useState<Session|null|undefined>(undefined);
 const [setupStatus,setSetupStatus]=useState<SetupStatus|null>(null);
 const [error,setError]=useState<unknown>(null);
 const [notice,setNotice]=useState({text:'',error:false});
 const acceptSession=useCallback((value:Session)=>{apply(value.pair);setSession(value);},[apply]);
 const refreshSession=useCallback(async()=>{setError(null);const [statusResult,sessionResult]=await Promise.allSettled([api<SetupStatus>('/setup/status'),api<Session>('/auth/me')]);if(statusResult.status==='fulfilled'){setSetupStatus(statusResult.value);if(sessionResult.status==='rejected')apply(statusResult.value);}else setError(statusResult.reason);if(sessionResult.status==='fulfilled')acceptSession(sessionResult.value);else if(sessionResult.reason instanceof ApiError&&sessionResult.reason.status===401)setSession(null);else setError(sessionResult.reason);},[apply,acceptSession]);
 useEffect(()=>{void refreshSession();const unauthorized=()=>{resetCsrf();setSession(null);};const focus=()=>void refreshSession();window.addEventListener('lovecloud:unauthorized',unauthorized);window.addEventListener('focus',focus);return()=>{window.removeEventListener('lovecloud:unauthorized',unauthorized);window.removeEventListener('focus',focus);};},[refreshSession]);
 const notify=useCallback((text:string,error=false)=>setNotice({text,error}),[]);
 const logout=async()=>{await api('/auth/logout','POST');resetCsrf();setSession(null);setNotice({text:'Вы вышли из пространства',error:false});};
 const loading=session===undefined||(!session&&!setupStatus);
 return <NoticeContext.Provider value={notify}>{loading?error?<main className="lc-auth"><ErrorBox error={error} retry={()=>void refreshSession()}/></main>:<main className="lc-auth"><Loading/></main>:!session?setupStatus?.required?<SetupWelcome/>:<Login onLogin={acceptSession}/>:session.user.mustChangePassword?<ChangePassword onDone={refreshSession} onLogout={()=>void logout().catch(e=>notify(String(e),true))}/>:<SWRConfig key={session.user.id} value={{provider:()=>new Map(),revalidateOnFocus:true,errorRetryCount:1,shouldRetryOnError:(e:ApiError)=>![401,403,423,429].includes(e.status)}}><Workspace session={session} onRefresh={refreshSession} onLogout={logout} notice={notice}/></SWRConfig>}{(!session||session.user.mustChangePassword)&&notice.text&&<div className={'lc-auth-status '+(notice.error?'lc-error':'')} role={notice.error?'alert':'status'}>{t(notice.text)}</div>}</NoticeContext.Provider>;
}
function Workspace({ session, onRefresh, onLogout, notice }: {
    session: Session;
    onRefresh: () => Promise<void>;
    onLogout: () => Promise<void>;
    notice: {
        text: string;
        error: boolean;
    };
}) {
    const { t, theme } = useI18n();
    const admin = session.user.role === 'admin';
    const { mutate } = useSWRConfig();
    const [route, setRoute] = useState<Route>({ view: 'cloud', folderId: null, query: '' });
    const [search, setSearch] = useState('');
    const [desk, setDesk] = useState(theme==='berry');
    useEffect(()=>setDesk(theme==='berry'),[theme]);
    const [paused, setPaused] = useState(false);
    const [mobile, setMobile] = useState(false);
    const [selected, setSelected] = useState<CloudFile | null>(null);
    const [preview, setPreview] = useState<CloudFile | null>(null);
    const [create, setCreate] = useState(0);
    const [upload, setUpload] = useState(0);
    const [taskCreate, setTaskCreate] = useState(0);
    const [wishCreate, setWishCreate] = useState(0);
    const [postCreate, setPostCreate] = useState(0);
    const [connection, setConnection] = useState("Подключаемся…");
    const main = useRef<HTMLElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const positions = useRef(new Map<string, number>());
    const routeRef = useRef(route);
    routeRef.current = route;
    const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { data: members = [] } = useSWR<Member[]>(!admin ? '/pair/members' : null, api);
    const { data: folders = [] } = useSWR<Folder[]>(!admin ? '/folders?space=shared' : null, api);
    const { data: storage } = useSWR<StorageInfo>(!admin ? '/storage' : null, api);
    const { data: activities = [] } = useSWR<Activity[]>(!admin ? '/activity' : null, api);
    const go = useCallback((view: string, folderId: string | null = null, query = '') => { const params = new URLSearchParams(); if (folderId)
        params.set('folder', folderId); if (query)
        params.set('q', query); const hash = '#' + view + (params.size ? '?' + params : ''); if (location.hash === hash)
        setRoute({ view, folderId, query });
    else
        location.hash = hash; }, []);
    useEffect(() => { const update = () => { if (location.hash === '#main') {
        main.current?.querySelector<HTMLElement>('h1')?.focus();
        return;
    } const previous = routeRef.current; positions.current.set(previous.view + '|' + previous.folderId + '|' + previous.query, main.current?.scrollTop || 0); const r = readRoute(); setRoute(r); setSearch(r.query); setMobile(false); setSelected(null); }; update(); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
    useEffect(() => { document.body.dataset.deskMode = desk ? 'desk' : 'catalog'; return () => { delete document.body.dataset.deskMode; }; }, [desk]);
    useEffect(() => { if (matchMedia('(prefers-reduced-motion: reduce)').matches)
        setPaused(true); }, []);
    useEffect(() => { document.body.classList.toggle('motion-paused', paused); }, [paused]);
    useEffect(() => { document.body.classList.toggle('nav-open', mobile); return () => document.body.classList.remove('nav-open'); }, [mobile]);
    useEffect(() => { if (main.current)
        main.current.scrollTop = positions.current.get(route.view + '|' + route.folderId + '|' + route.query) || 0; if (document.activeElement !== searchRef.current)
        main.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }); }, [route.view, route.folderId]);
    useEffect(() => { if (admin)
        return; let disposed = false; let connection: import('@microsoft/signalr').HubConnection | undefined; let timer: ReturnType<typeof setTimeout> | undefined; const refresh = (event?:{area?:string}) => {void mutate(() => true);if(!event||event.area==='settings')void onRefresh();}; void import('@microsoft/signalr').then(async (signalr) => { if (disposed)
        return; connection = new signalr.HubConnectionBuilder().withUrl('/hubs/workspace', { withCredentials: true }).withAutomaticReconnect().configureLogging(signalr.LogLevel.Warning).build(); connection.on('WorkspaceChanged', refresh); connection.onreconnecting(() => setConnection("Восстанавливаем связь…")); connection.onreconnected(() => { setConnection("Мы на связи ♡"); refresh(); }); connection.onclose(() => { if (!disposed) {
        setConnection("Связь потеряна · повторяем");
        timer = setTimeout(start, 5000);
    } }); const start = async () => { if (disposed || !connection)
        return; try {
        await connection.start();
        if (disposed) {
            await connection.stop();
            return;
        }
        setConnection("Мы на связи ♡");
        refresh();
    }
    catch {
        if (!disposed) {
            setConnection("Нет связи · повторяем");
            timer = setTimeout(start, 5000);
        }
    } }; await start(); }); const online = () => { setConnection(navigator.onLine ? t("Восстанавливаем связь…") : t("Нет сети")); if (navigator.onLine)
        refresh(); }; window.addEventListener('online', online); window.addEventListener('offline', online); return () => { disposed = true; if (timer)
        clearTimeout(timer); connection?.off('WorkspaceChanged', refresh); void connection?.stop(); window.removeEventListener('online', online); window.removeEventListener('offline', online); }; }, [admin, mutate, onRefresh]);
    useEffect(() => () => { if (timeout.current)
        clearTimeout(timeout.current); }, []);
    const onSearch = (value: string) => { setSearch(value); if (timeout.current)
        clearTimeout(timeout.current); timeout.current = setTimeout(() => go('cloud', null, value.trim()), 250); };
    const quick = (kind: string) => { if (kind === 'folder') {
        if (route.view === 'cloud')
            setCreate(v => v + 1);
        else {
            go('cloud');
            setCreate(v => v + 1);
        }
    } if (kind === 'post') {
        go('messages');
        setPostCreate(v => v + 1);
    } if (kind === 'memory') {
        go('feed');
        setPostCreate(v => v + 1);
    } if (kind === 'task') {
        go('planner');
        setTaskCreate(v => v + 1);
    } if (kind === 'wish') {
        go('wishes');
        setWishCreate(v => v + 1);
    } };
    const view = route.view;
    const folderLinks = (parent: string | null, seen = new Set<string>()): React.ReactNode => folders.filter(f => (f.parentId || null) === parent && !seen.has(f.id)).map(f => <div key={f.id} className="wp-tree-item"><button className={'wp-tree-link ' + (route.folderId === f.id ? 'is-active' : '')} onClick={() => go('cloud', f.id)}><Icon name="folder"/><span>{f.name}</span></button><div className="wp-tree-children">{folderLinks(f.id, new Set([...seen, f.id]))}</div></div>);
    return <><a className="shell-skip" href="#main">{t("К содержимому")}</a><div className="shell-heartfield" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i}>♡</span>)}</div><div className="shell-app"><aside className="shell-sidebar" aria-label={t("Навигация и папки")}><a className="shell-brand" href="#cloud"><span className="shell-brand-mark"/><span>LoveCloud<small>{t("Наше рисованное облако")}</small></span></a><div className="shell-actions"><button className="shell-create" onClick={() => admin ? main.current?.querySelector('input')?.focus() : quick(view === 'planner' ? 'task' : view === 'wishes' ? 'wish' : 'folder')}><Icon name="plus"/><span>{t("Создать")}</span></button>{!admin && <button className="shell-upload" title={t("Загрузить файлы")} onClick={() => { go('cloud', route.folderId); setUpload(v => v + 1); }}><Icon name="upload"/></button>}</div><nav className="shell-nav" aria-label={t("Разделы облака")}><div className="shell-nav-group">{admin ? <><button onClick={()=>go('cloud')} className={'shell-nav-item '+(view!=='settings'?'is-active':'')} aria-current={view!=='settings'?'page':undefined}><Icon name="lock"/><span>{t("Настройка пары")}</span></button><button data-nav="settings" className={'shell-nav-item '+(view==='settings'?'is-active':'')} onClick={()=>go('settings')}><Icon name="info"/><span>{t("Настройки")}</span></button></> : nav.filter(n => !['trash', 'activity'].includes(n[0])).map(([id, i, title]) => <button key={id} className={'shell-nav-item ' + (view === id ? 'is-active' : '')} data-nav={id} aria-current={view === id ? 'page' : undefined} onClick={() => go(id)}><Icon name={i}/><span>{t(title)}</span></button>)}</div></nav>{!admin && <><section className="shell-tree-section" aria-label={t("Дерево папок")}><div className="shell-tree-label">{t("Конверты и папки ♡")}</div><div data-folder-tree>{folders.length ? folderLinks(null) : <p className="wp-footnote">{t("Первая папка ещё впереди")}</p>}</div></section><div className="shell-bottom-nav">{nav.filter(n => ['trash', 'activity'].includes(n[0])).map(([id, i, title]) => <button key={id} data-nav={id} className={'shell-nav-item ' + (view === id ? 'is-active' : '')} onClick={() => go(id)}><Icon name={i}/><span>{t(title)}</span></button>)}</div><div className="shell-storage"><div><Icon name="cloud"/><strong>{t("Наше хранилище")}</strong><span>{storage ? Math.round(storage.usedBytes / storage.quotaBytes * 100) : 0}%</span></div><div className="shell-storage-track"><i style={{ width: storage ? Math.min(100, storage.usedBytes / storage.quotaBytes * 100) + '%' : '0%' }}/></div><p>{storage ? bytes(storage.usedBytes) : '…'} <span>{t("из ")}{storage ? bytes(storage.quotaBytes) : '…'}</span></p></div></>}<ActionButton className="wp-text lc-logout" action={onLogout}>{t("Выйти · ")}{session.user.displayName}</ActionButton></aside><header className="shell-topbar"><button className="shell-mobile-menu" aria-label={t("Открыть или закрыть навигацию")} aria-expanded={mobile} onClick={() => setMobile(v => !v)}><Icon name="menu"/></button><div className="shell-topbar-title"><span>{t("Наше пространство")}</span></div>{!admin && <label className="shell-search"><Icon name="search"/><input ref={searchRef} type="search" value={search} onChange={e => onSearch(e.target.value)} aria-label={t("Поиск по облаку")} placeholder={t("Найти что-нибудь наше…")}/><span className="shell-search-hint">{t("в нашем облаке")}</span></label>}<div className="shell-pair"><Avatar name={session.pair.name||t('Ваша пара')} url={session.pair.avatarUrl} className="lc-pair-avatar"/><div className="shell-avatars" aria-hidden="true">{members.map(m => <Avatar key={m.id} name={m.displayName} url={m.avatarUrl}/>)}</div><div><strong>{session.pair.name || t("Наше пространство")}</strong><small>{session.user.displayName}</small></div></div></header><div className="shell-layout"><main id="main" ref={main} className="shell-main">{view==='settings'?<Settings key={session.pair.locale+'-'+session.pair.theme} session={session} onRefresh={onRefresh}/>:admin ? <Admin session={session} onRefresh={onRefresh}/> : ['cloud', 'recent', 'favorites', 'trash'].includes(view) ? <Cloud key={view} view={view} folderId={route.folderId} query={route.query} desk={desk} onDesk={setDesk} onFolder={id => go('cloud', id)} onPreview={setPreview} onSelect={setSelected} openCreate={create} openUpload={upload} onCreateConsumed={() => setCreate(0)} onUploadConsumed={() => setUpload(0)}/> : view === 'albums' ? <Albums onPreview={setPreview}/> : view === 'messages' || view === 'feed' ? <Social key={view} kind={view === 'feed' ? 'memory' : 'all'} user={session.user} onPreview={setPreview} composeVersion={postCreate}/> : view === 'planner' ? <Planner members={members} createVersion={taskCreate} onConsumed={() => setTaskCreate(0)}/> : view === 'wishes' ? <Wishes user={session.user} members={members} createVersion={wishCreate} onConsumed={() => setWishCreate(0)}/> : view === 'vault' ? <Vault desk={desk} onDesk={setDesk}/> : <ActivityView />}</main><aside className="shell-details wp-details" aria-label={t("Сведения и активность")}><div className="wp-details-title"><h2>{selected ? t("Сведения о файле") : t("Наше пространство")}</h2><Icon name="heart"/></div>{selected ? <><div className="wp-detail-preview"><Thumb file={selected}/></div><h3 className="wp-detail-name">{selected.name}</h3><dl className="wp-property-list"><div><dt>{t("Автор")}</dt><dd>{selected.ownerName}</dd></div><div><dt>{t("Размер")}</dt><dd>{bytes(selected.size)}</dd></div><div><dt>{t("Изменён")}</dt><dd>{date(selected.updatedAt)}</dd></div><div><dt>{t("Папка")}</dt><dd>{folderPath(folders, selected.folderId || null).map(f => f.name).join(' / ') || t("Наше облако")}</dd></div></dl><Button className="wp-primary" icon="eye" onClick={() => setPreview(selected)}>{t("Предпросмотр")}</Button><Button className="wp-text" onClick={() => setSelected(null)}>{t("Закрыть сведения")}</Button></> : <><div className="wp-pair-card"><div className="wp-pair-avatars">{members.map(m => <Avatar key={m.id} name={m.displayName} url={m.avatarUrl}/>)}</div><h3>{session.pair.name || t("Наше пространство")}</h3><p>{members.map(m => m.displayName).join(t(" и ")) || session.user.displayName}</p><span className="wp-badge">{t("Только для вас")}</span></div>{storage && <div className="wp-overview-stats"><div><strong>{storage.fileCount}</strong><span>{noun(storage.fileCount, [t("файл"), t("файла"), t("файлов")])}</span></div><div><strong>{folders.length}</strong><span>{noun(folders.length, [t("папка"), t("папки"), t("папок")])}</span></div><div><strong>♡</strong><span>{t("вместе")}</span></div></div>}<h3 className="wp-small-heading">{t("Последние события")}</h3>{activities.slice(0, 4).map(a => <p className="wp-detail-event" key={a.id}><strong>{a.actorName}</strong> {activityText(a.text)}<small>{date(a.createdAt, true)}</small></p>)}{!activities.length && <p className="wp-footnote">{t("Здесь появятся ваши первые общие действия.")}</p>}</>}<div className="wp-pocket-space"/></aside></div><footer className="shell-statusbar"><span>{t(connection)}</span><span role={notice.error ? 'alert' : 'status'} aria-live="polite" className={notice.error ? 'lc-inline-error' : ''}>{t(notice.text) || t("Все наши дни — в одном месте ♡")}</span><button className="shell-motion-toggle" aria-pressed={paused} aria-label={paused ? t("Включить анимации") : t("Приостановить анимации")} onClick={() => setPaused(v => !v)}>♡ {paused ? t("Сердечки на паузе") : t("Остановить сердечки")}</button></footer></div>{!admin && <Pocket onQuick={quick}/>} {preview && <Preview file={preview} onClose={() => setPreview(null)}/>}</>;
}
function ActivityView() { const { t } = useI18n(); const { data, error, isLoading, mutate } = useSWR<Activity[]>('/activity', api); return <><Heading title={t("История активности")} subtitle={t("Наше облако, публикации, альбомы и дела")}/>{error ? <ErrorBox error={error} retry={() => void mutate()}/> : isLoading ? <Loading /> : data?.length ? <div className="wp-activity-list">{data.map(a => <article className="wp-activity-item" key={a.id}><span className="wp-activity-icon"><Icon name="activity"/></span><div><p><strong>{a.actorName}</strong> {activityText(a.text)}</p><small>{date(a.createdAt, true)}</small></div></article>)}</div> : <Empty title={t("Начало нашей истории")}><p>{t("Здесь появятся общие действия. Личное и подарочные резервы сюда не попадают.")}</p></Empty>}</>; }
function Pocket({ onQuick }: {
    onQuick: (kind: string) => void;
}) { const { t } = useI18n(); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null); const launcher = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null); useEffect(() => { if (!open)
    return; menu.current?.querySelector<HTMLButtonElement>('button')?.focus(); const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node))
    setOpen(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, [open]); return <div className="wp-pocket" ref={ref} onKeyDown={e => { const items = [...menu.current?.querySelectorAll<HTMLButtonElement>('button') || []]; const at = items.indexOf(document.activeElement as HTMLButtonElement); if (e.key === 'Escape') {
    e.preventDefault();
    setOpen(false);
    launcher.current?.focus();
} if (e.key === 'Tab') {
    setOpen(false);
    launcher.current?.focus();
} if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    if (!open) {
        setOpen(true);
        return;
    }
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
} }}><div id="lc-pocket-menu" ref={menu} className="wp-pocket-menu" role="menu" aria-label={t("Что положить на стол?")} hidden={!open}>{[['memory', 'heart', t("Воспоминание")], ['post', 'mail', t("Послание")], ['task', 'calendar', t("Дело")], ['wish', 'gift', t("Желание")], ['folder', 'folder', t("Папка")]].map(([id, icon, label]) => <button key={id} role="menuitem" tabIndex={-1} className="wp-button" onClick={() => { setOpen(false); launcher.current?.focus(); onQuick(id); }}><Icon name={icon}/><span>{label}</span></button>)}</div><button ref={launcher} data-label={t('Положить на стол')} aria-label={t('Положить на стол')} className="wp-button wp-pocket-button" aria-haspopup="menu" aria-expanded={open} aria-controls="lc-pocket-menu" onClick={() => setOpen(v => !v)}><span className="wp-pocket-mark" aria-hidden="true"><Icon name="plus"/></span><span>{t("Положить на стол")}</span></button></div>; }

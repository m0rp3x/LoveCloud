'use client';
import {useI18n, translate as t} from '@/lib/i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { api, uploadFile, allSharedFiles } from '@/lib/api';
import type { Album, CloudFile, Folder } from '@/lib/types';
import { ActionButton, Button, Dialog, Empty, ErrorBox, Field, Footer, Heading, Icon, Loading, Thumb, bytes, date, extension, useAction, useNotice, burst } from './ui';
export type CloudProps = {
    view: string;
    folderId: string | null;
    query: string;
    space?: 'shared' | 'vault';
    desk: boolean;
    onDesk: (value: boolean) => void;
    onFolder: (id: string | null) => void;
    onPreview: (file: CloudFile) => void;
    onSelect: (file: CloudFile | null) => void;
    openCreate?: number;
    openUpload?: number;
    onCreateConsumed?: () => void;
    onUploadConsumed?: () => void;
};
export function folderPath(folders: Folder[], id: string | null) { const result: Folder[] = []; const seen = new Set<string>(); while (id && !seen.has(id)) {
    seen.add(id);
    const f = folders.find(x => x.id === id);
    if (!f)
        break;
    result.unshift(f);
    id = f.parentId || null;
} return result; }
export default function Cloud({ view, folderId, query, space = 'shared', desk, onDesk, onFolder, onPreview, onSelect, openCreate = 0, openUpload = 0, onCreateConsumed, onUploadConsumed }: CloudProps) {
    const { t,theme } = useI18n();
    const { mutate: refresh } = useSWRConfig();
    const notice = useNotice();
    const refreshAll = () => refresh(() => true);
    const action = useAction();
    const folderKey = `/folders?space=${space}`;
    const { data: folders = [], error: folderError } = useSWR<Folder[]>(folderKey, api);
    const params = new URLSearchParams({ space });
    if (query)
        params.set('q', query);
    else if (['recent', 'favorites', 'trash'].includes(view))
        params.set('view', view);
    else if (folderId)
        params.set('folderId', folderId);
    const key = '/files?' + params;
    const { data: files, error, isLoading, mutate } = useSWR<CloudFile[]>(key, api, { keepPreviousData: false });
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [layout, setLayout] = useState(theme==='rose'?'list':'grid');
    useEffect(()=>setLayout(theme==='rose'?'list':'grid'),[theme]);
    const [sort, setSort] = useState('updated');
    const [type, setType] = useState('all');
    const [modal, setModal] = useState<{
        kind: 'folder' | 'envelope' | 'file' | 'rename-folder' | 'delete-folder' | 'trash';
        file?: CloudFile;
        folder?: Folder;
    } | null>(null);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => { setSelected(new Set()); onSelect(null); }, [key]);
    const createSeen = useRef(0);
    const uploadSeen = useRef(0);
    useEffect(() => { if (openCreate && createSeen.current !== openCreate) {
        setModal({ kind: 'folder' });
        onCreateConsumed?.();
    } createSeen.current = openCreate; }, [openCreate]);
    useEffect(() => { if (openUpload && uploadSeen.current !== openUpload) {
        input.current?.click();
        onUploadConsumed?.();
    } uploadSeen.current = openUpload; }, [openUpload]);
    const queue = useUploads(folderId, space, refreshAll);
    const current = folderPath(folders, folderId);
    let list = (files || []).filter(f => type === 'all' || f.mimeType.startsWith(type));
    list = [...list].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'ru') : sort === 'size' ? b.size - a.size : b.updatedAt.localeCompare(a.updatedAt));
    const children = folders.filter(f => query ? f.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')) : ((f.parentId || null) === folderId));
    const isTrash = view === 'trash';
    const toggle = (f: CloudFile, checked: boolean) => { setSelected(s => { const n = new Set(s); checked ? n.add(f.id) : n.delete(f.id); return n; }); onSelect(f); };
    const favorite = async (f: CloudFile) => { await api(`/files/${f.id}/favorite`, f.favorite ? 'DELETE' : 'PUT'); await refreshAll(); };
    const submit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void action.run(async () => {
            const name = String(form.get('name') || '').trim();
            const parentId = String(form.get('parentId') || '') || null;
            if (modal?.kind === 'envelope') {
                const folder = await api<Folder>('/folders/envelope', 'POST', { name, parentId, fileIds: [...selected] });
                setSelected(new Set());
                setModal(null);
                await refreshAll();
                onFolder(folder.id);
                notice(t("Материалы собраны в конверт. Ссылки сохранены."));
                return;
            }
            if (modal?.kind === 'folder') {
                await api('/folders', 'POST', { name, parentId, space });
            }
            if (modal?.kind === 'file') {
                await api(`/files/${modal.file!.id}`, 'PATCH', { name, folderId: parentId });
            }
            if (modal?.kind === 'rename-folder') {
                await api(`/folders/${modal.folder!.id}`, 'PATCH', { name });
            }
            setModal(null);
            await refreshAll();
            notice(t("Изменения сохранены"));
        });
    };
    const trash = async () => { for (const id of selected)
        await api(`/files/${id}`, 'DELETE'); setSelected(new Set()); onSelect(null); await refreshAll(); setModal(null); notice(t("Материалы перемещены в корзину")); };
    return <><nav className="wp-breadcrumbs" aria-label={t("Путь папки")}><Button className="wp-text" onClick={() => onFolder(null)}>{space === 'vault' ? t("Личное") : t("Наше облако")}</Button>{current.map(f => <span key={f.id}><Icon name="chevron"/><Button className="wp-text" onClick={() => onFolder(f.id)}>{f.name}</Button></span>)}</nav><Heading title={query ? t("Поиск: ") + query : ({ recent: t("Недавние"), favorites: t("Избранное"), trash: t("Корзина") }[view] || current.at(-1)?.name || (space === 'vault' ? t("Личное") : t("Наше облако")))} subtitle={space === 'vault' ? t("Общий приватный раздел пары") : t("Наши фотографии, документы и маленькие сокровища")}><Button icon="folder" onClick={() => setModal({ kind: 'folder' })}>{t("Новая папка")}</Button><Button icon="upload" className="wp-primary" onClick={() => input.current?.click()}>{t("Загрузить")}</Button><input ref={input} type="file" multiple className="wp-sr-only" aria-label={t("Выбрать файлы для загрузки")} onChange={e => { queue.add([...e.target.files || []]); e.target.value = ''; }}/></Heading>
 <div className="wp-desk-switch" role="group" aria-label={t("Способ смотреть материалы")}><Button icon="heart" aria-pressed={desk} onClick={() => onDesk(true)}>{t("Живой стол")}</Button><Button icon="list" aria-pressed={!desk} onClick={() => onDesk(false)}>{t("Каталог")}</Button><span className="wp-desk-hint">{desk ? t("Все наши материалы на одном столе ♡") : t("Всё по порядку")}</span></div>
 <div className="wp-toolbar"><div className="wp-filter-group"><label className="wp-inline-field"><span className="wp-sr-only">{t("Тип файлов")}</span><select value={type} onChange={e => setType(e.target.value)}><option value="all">{t("Все типы")}</option><option value="image/">{t("Фото")}</option><option value="video/">{t("Видео")}</option><option value="audio/">{t("Аудио")}</option><option value="application/">{t("Документы")}</option></select></label><span className="wp-result-count">{t("Файлов: ")}{list.length}</span></div><div className="wp-filter-group"><label className="wp-inline-field"><span className="wp-sr-only">{t("Сортировка")}</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="updated">{t("Сначала новые")}</option><option value="name">{t("По названию")}</option><option value="size">{t("По размеру")}</option></select></label>{!desk && <div className="wp-segment" aria-label={t("Вид файлов")}><Button icon="list" className="wp-icon-button" aria-label={t("Список")} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}/><Button icon="grid" className="wp-icon-button" aria-label={t("Сетка")} aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}/></div>}</div></div>
 {selected.size > 0 && <div className="wp-selection-bar"><strong>{t("Выбрано: ")}{selected.size}</strong><div>{!isTrash && <Button icon="mail" onClick={() => setModal({ kind: 'envelope' })}>{t("Собрать в конверт")}</Button>}{isTrash ? <ActionButton icon="restore" action={async () => { for (const id of selected)
        await api(`/files/${id}/restore`, 'POST'); setSelected(new Set()); await refreshAll(); }}>{t("Восстановить")}</ActionButton> : <Button icon="trash" onClick={() => setModal({ kind: 'trash' })}>{t("В корзину")}</Button>}<Button onClick={() => { setSelected(new Set()); onSelect(null); }}>{t("Снять выделение")}</Button></div></div>}
 {view === 'cloud' && !isTrash && children.length > 0 && <section aria-label={t("Папки")}><div className="wp-section-label"><h2>{t("Конверты и папки")}</h2><span>{children.length}</span></div><div className="wp-folder-grid">{children.map(f => <div className="lc-folder-wrap" key={f.id}><button className="wp-folder-card" onClick={() => onFolder(f.id)}><Icon name="folder"/><div><strong>{f.name}</strong><small>{t("Открыть папку")}</small></div><Icon name="chevron"/></button><div className="lc-folder-actions"><Button className="wp-icon-button" icon="file" aria-label={t("Переименовать ") + f.name} onClick={() => setModal({ kind: 'rename-folder', folder: f })}/><Button className="wp-icon-button" icon="trash" aria-label={t("Удалить папку ") + f.name} onClick={() => setModal({ kind: 'delete-folder', folder: f })}/></div></div>)}</div></section>}
 {folderError && <ErrorBox error={folderError}/>}<div className="wp-section-label"><h2>{t("Материалы")}</h2><span className="wp-badge">{space === 'vault' ? t("Дополнительный вход подтверждён") : t("Только для пары")}</span></div>{error ? <ErrorBox error={error} retry={() => void mutate()}/> : isLoading ? <Loading /> : !list.length ? <Empty title={isTrash ? t("Корзина пуста") : query ? t("Ничего не найдено") : t("Здесь пока чистый лист")}><p>{isTrash ? t("Удалённые материалы появятся здесь.") : query ? t("Попробуйте другое название или сбросьте фильтр.") : t("Загрузите первые фотографии или создайте папку для общих планов.")}</p>{!isTrash && <Button className="wp-primary" icon="upload" onClick={() => input.current?.click()}>{t("Добавить файлы")}</Button>}</Empty> : (!desk && layout === 'list') ? <div className="wp-table-scroll" tabIndex={0} role="region" aria-label={t("Таблица файлов")}><table className="wp-file-table"><thead><tr><th>{t("Выбор")}</th><th>{t("Название")}</th><th>{t("Автор")}</th><th>{t("Изменён")}</th><th>{t("Размер")}</th><th>{t("Действия")}</th></tr></thead><tbody>{list.map(f => <tr key={f.id} className={selected.has(f.id) ? 'is-selected' : ''}><td><input aria-label={t("Выбрать ") + f.name} type="checkbox" checked={selected.has(f.id)} onChange={e => toggle(f, e.target.checked)}/></td><td><Button className="wp-file-name" onClick={() => onSelect(f)}>{f.name}</Button></td><td>{f.ownerName}</td><td>{date(f.updatedAt)}</td><td>{bytes(f.size)}</td><td><Button icon="eye" className="wp-icon-button" aria-label={t("Открыть ") + f.name} onClick={() => onPreview(f)}/>{!isTrash && <ActionButton icon="heart" className="wp-icon-button" aria-label={t("Избранное")} aria-pressed={f.favorite} action={() => favorite(f)}/>}</td></tr>)}</tbody></table></div> : <div className="wp-file-grid">{list.map(f => <article key={f.id} className={'wp-file-card ' + (selected.has(f.id) ? 'is-selected' : '')}><div className="wp-file-card-top"><label className="wp-check-target"><input type="checkbox" aria-label={t("Выбрать ") + f.name} checked={selected.has(f.id)} onChange={e => toggle(f, e.target.checked)}/></label>{!isTrash && <ActionButton icon="heart" className="wp-icon-button" aria-label={t("Избранное")} aria-pressed={f.favorite} action={() => favorite(f)}/>}</div><button type="button" className="wp-thumbnail" aria-label={t("Предпросмотр ") + f.name} onClick={() => onPreview(f)}><Thumb file={f}/></button><div className="wp-file-card-body"><Button className="wp-file-name" onClick={() => onSelect(f)}>{f.name}</Button><div className="wp-file-subline"><span>{extension(f.name)} · {bytes(f.size)}</span><span>{date(f.updatedAt)}</span></div><div className="wp-file-owner"><span className="wp-avatar wp-avatar-small">{f.ownerName?.[0] || '♡'}</span>{f.ownerName}<Button className="wp-icon-button" icon="file" aria-label={t("Переименовать или переместить ") + f.name} onClick={() => setModal({ kind: 'file', file: f })}/></div></div></article>)}</div>}
 {queue.items.length > 0 && <section className="lc-upload-list" aria-label={t("Загрузки")}>{queue.items.map(i => <article key={i.id}><strong>{i.file.name}</strong><progress value={i.progress} max={100} aria-label={t("Загрузка ") + i.file.name}/><span>{i.state === 'done' ? t("Загружено") : i.state === 'uploading' ? i.progress === 100 ? t("Сохраняем файл…") : `${i.progress}%` : i.error}</span>{i.state === 'uploading' ? <Button onClick={() => queue.cancel(i.id)}>{t("Отменить")}</Button> : i.state === 'error' ? <Button onClick={() => queue.retry(i.id)}>{t("Повторить")}</Button> : null}</article>)}</section>}
 {modal && <Dialog title={{ folder: t("Новая папка"), envelope: t("Собрать в конверт"), file: t("Название и расположение"), trash: t("Переместить в корзину?"), 'rename-folder': t("Название папки"), 'delete-folder': t("Удалить пустую папку?") }[modal.kind]} onClose={() => setModal(null)}>{modal.kind === 'trash' ? <><p>{t("Материалы можно будет восстановить из корзины. Выбрано: ")}{selected.size}.</p><ActionButton icon="trash" className="wp-primary" action={trash}>{t("Переместить")}</ActionButton></> : modal.kind === 'delete-folder' ? <><p>{t("Папка «")}{modal.folder?.name}{t("» будет удалена. Непустую папку API сохранит.")}</p><ActionButton className="wp-primary" action={async () => { await api(`/folders/${modal.folder!.id}`, 'DELETE'); await refreshAll(); setModal(null); }}>{t("Удалить папку")}</ActionButton></> : <form onSubmit={submit}><Field label={modal.kind === 'envelope' ? t("Название конверта") : t("Название")}><input name="name" required maxLength={180} defaultValue={modal.file?.name || modal.folder?.name || ''}/></Field>{modal.kind !== 'rename-folder' && <Field label={t("Расположение")}><select name="parentId" defaultValue={modal.file?.folderId || folderId || ''}><option value="">{space === 'vault' ? t("Личное") : t("Наше облако")}</option>{folders.map(f => <option key={f.id} value={f.id}>{folderPath(folders, f.id).map(x => x.name).join(' / ')}</option>)}</select></Field>}{modal.kind === 'envelope' && <p>{t("Выбрано файлов: ")}{selected.size}{t(". Ссылки альбомов и воспоминаний сохранятся.")}</p>}{action.error && <ErrorBox error={new Error(action.error)}/>}<Footer busy={action.busy} label={modal.kind === 'envelope' ? t("Собрать в конверт") : t("Сохранить")} onCancel={() => setModal(null)}/></form>}</Dialog>}<div className="wp-pocket-space" aria-hidden="true"/></>;
}
type UploadItem = {
    id: string;
    file: File;
    folderId: string | null;
    progress: number;
    state: 'uploading' | 'done' | 'error';
    error?: string;
};
function useUploads(folderId: string | null, space: 'shared' | 'vault', refresh: () => Promise<unknown>) { const [items, setItems] = useState<UploadItem[]>([]); const controllers = useRef(new Map<string, AbortController>()); const mounted = useRef(true); const notice = useNotice(); useEffect(() => { mounted.current = true; return () => { mounted.current = false; controllers.current.forEach(c => c.abort()); }; }, []); const update = (id: string, patch: Partial<UploadItem>) => { if (mounted.current)
    setItems(x => x.map(i => i.id === id ? { ...i, ...patch } : i)); }; async function send(item: UploadItem) { if (!mounted.current)
    return; const c = new AbortController(); controllers.current.set(item.id, c); try {
    await uploadFile(item.file, item.folderId, space, p => update(item.id, { progress: p }), c.signal);
    if (!mounted.current)
        return;
    update(item.id, { state: 'done', progress: 100 });
    await refresh();
    if (mounted.current)
        notice(space === 'vault' ? t("Файл загружен в личный раздел") : t("Файл загружен: ") + item.file.name);
}
catch (e) {
    update(item.id, { state: 'error', error: e instanceof DOMException && e.name === 'AbortError' ? t("Загрузка отменена") : e instanceof Error ? e.message : t("Ошибка загрузки") });
}
finally {
    controllers.current.delete(item.id);
} } return { items, add: (files: File[]) => { const added = files.map(file => ({ id: crypto.randomUUID(), file, folderId, progress: 0, state: 'uploading' as const })); setItems(x => [...x, ...added]); void (async () => { for (let i = 0; i < added.length && mounted.current; i += 2)
        await Promise.all(added.slice(i, i + 2).map(send)); })(); }, cancel: (id: string) => controllers.current.get(id)?.abort(), retry: (id: string) => { const item = items.find(i => i.id === id); if (item) {
        update(id, { state: 'uploading', progress: 0 });
        void send(item);
    } } }; }
export function Albums({ onPreview }: {
    onPreview: (file: CloudFile) => void;
}) {
    const { t } = useI18n();
    const { data: albums, error, isLoading, mutate } = useSWR<Album[]>('/albums', api);
    const [active, setActive] = useState<Album | null>(null);
    const [form, setForm] = useState<Album | null>(null);
    const action = useAction();
    const { data: assets = [], isLoading: loading, error: assetError } = useSWR<CloudFile[]>(active || form ? '$shared-file-picker' : null, allSharedFiles);
    useEffect(() => { if (active && albums) {
        setActive(albums.find(a => a.id === active.id) || null);
    } }, [albums]);
    return <><Heading title={active?.name || t("Общие альбомы")} subtitle={t("Те же файлы, собранные в наши истории")}><Button icon="plus" onClick={() => setForm({ id: '', name: '', fileIds: [] })}>{t("Создать альбом")}</Button>{active && <Button onClick={() => setActive(null)}>{t("Все альбомы")}</Button>}</Heading>{error ? <ErrorBox error={error}/> : isLoading ? <Loading /> : active ? <>{assetError && <ErrorBox error={assetError}/>} {loading ? <Loading /> : <div className="wp-file-grid">{assets.filter(f => active.fileIds.includes(f.id)).map(f => <article className="wp-file-card" key={f.id}><button className="wp-thumbnail" onClick={() => onPreview(f)}><Thumb file={f}/></button><div className="wp-file-card-body"><strong>{f.name}</strong></div></article>)}</div>}<div className="wp-toolbar"><Button onClick={() => setForm(active)}>{t("Изменить альбом")}</Button><ActionButton icon="trash" action={async () => { if (!confirm(t("Удалить альбом? Исходные файлы сохранятся.")))
        return; await api('/albums/' + active.id, 'DELETE'); setActive(null); await mutate(); }}>{t("Удалить альбом")}</ActionButton></div></> : albums?.length ? <div className="wp-album-grid">{albums.map(a => <button key={a.id} className="wp-album-card" onClick={() => setActive(a)}>{a.coverUrl ? <img src={a.coverUrl} alt={a.name} width={640} height={420}/> : <div className="lc-album-cover"><Icon name="heart"/></div>}<div><h2>{a.name}</h2><span>{t("Материалов: ")}{a.fileIds.length}</span></div></button>)}</div> : <Empty title={t("Первый альбом ещё впереди")}><p>{t("Загрузите файлы в облако, затем соберите их в общую историю.")}</p></Empty>}{action.error && <ErrorBox error={new Error(action.error)}/>} {form && <Dialog title={form.id ? t("Изменить альбом") : t("Новый альбом")} onClose={() => setForm(null)}><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action.run(async () => { await api('/albums' + (form.id ? '/' + form.id : ''), form.id ? 'PATCH' : 'POST', { name: f.get('name'), fileIds: f.getAll('files') }); setForm(null); setActive(null); await mutate(); }); }}>{assetError && <ErrorBox error={assetError}/>}<Field label={t("Название альбома")}><input name="name" defaultValue={form.name} required maxLength={180}/></Field>{loading ? <Loading /> : <fieldset className="wp-album-picker"><legend>{t("Материалы из облака")}</legend>{assets.map(f => <label key={f.id}><input type="checkbox" name="files" value={f.id} defaultChecked={form.fileIds.includes(f.id)}/>{f.name}</label>)}{!assets.length && <p>{t("Сначала загрузите файлы в облако.")}</p>}</fieldset>}{action.error && <ErrorBox error={new Error(action.error)}/>}<Footer busy={action.busy} label={t("Сохранить альбом")} onCancel={() => setForm(null)}/></form></Dialog>}</>;
}

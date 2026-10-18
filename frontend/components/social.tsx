'use client';
import {useI18n, translate as t} from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRInfinite from 'swr/infinite';
import { api, allSharedFiles } from '@/lib/api';
import type { CloudFile, FeedPage, Folder, Post, User } from '@/lib/types';
import { ActionButton, Button, Dialog, Empty, ErrorBox, Field, Footer, Heading, Icon, Loading, Thumb, Avatar, date, useAction, useNotice, burst } from './ui';
export function FilePicker({ selected, onChange }: {
    selected: string[];
    onChange: (ids: string[]) => void;
}) { const { t } = useI18n(); const { data, error, isLoading } = useSWR<CloudFile[]>('$shared-file-picker', allSharedFiles); return <fieldset className="wp-album-picker"><legend>{t("Прикрепить материалы из облака (до 10)")}</legend>{error ? <ErrorBox error={error}/> : isLoading ? <Loading /> : data?.length ? data.map(f => <label key={f.id}><input type="checkbox" checked={selected.includes(f.id)} disabled={!selected.includes(f.id) && selected.length >= 10} onChange={e => onChange(e.target.checked ? [...selected, f.id] : selected.filter(id => id !== f.id))}/>{f.name}</label>) : <p>{t("Пока нет файлов. Загрузите их в облако.")}</p>}</fieldset>; }
export default function Social({ kind, user, onPreview, composeVersion = 0 }: {
    kind: 'all' | 'memory';
    user: User;
    onPreview: (f: CloudFile) => void;
    composeVersion?: number;
}) {
    const { t } = useI18n();
    const notice = useNotice();
    const { mutate: refresh } = useSWRConfig();
    const { data, error, isLoading, size, setSize, isValidating, mutate } = useSWRInfinite<FeedPage>((index, previous) => { if (previous && !previous.nextCursor)
        return null; return `/feed?kind=${kind}&limit=20${index ? '&cursor=' + encodeURIComponent(previous!.nextCursor!) : ''}`; }, api, { revalidateFirstPage: true, persistSize: true });
    const [body, setBody] = useState('');
    const [files, setFiles] = useState<string[]>([]);
    const [picker, setPicker] = useState(false);
    const action = useAction();
    const clientId = useRef(crypto.randomUUID());
    const input = useRef<HTMLTextAreaElement>(null);
    const sentinel = useRef<HTMLDivElement>(null);
    const posts = [...new Map((data || []).flatMap(p => p.items).map(p => [p.id, p])).values()].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    const more = Boolean(data?.at(-1)?.nextCursor);
    useEffect(() => { if (composeVersion)
        input.current?.focus(); }, [composeVersion]);
    useEffect(() => { const node = sentinel.current; if (!node || !more || isValidating)
        return; const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting)
        void setSize(size + 1); }, { rootMargin: '200px' }); observer.observe(node); return () => observer.disconnect(); }, [more, isValidating, size, setSize]);
    return <><Heading title={kind === 'memory' ? t("Воспоминания") : t("Послания")} subtitle={kind === 'memory' ? t("Наши дни, которые хочется сохранить") : t("Наша маленькая социальная лента")}/><div className="wp-social-layout"><div className="wp-social-main"><form className="wp-social-compose" onSubmit={e => { e.preventDefault(); if (!body.trim() && !files.length)
        return; void action.run(async () => { await api('/posts', 'POST', { kind: kind === 'memory' ? 'memory' : 'message', body: body.trim(), fileIds: files, clientPostId: clientId.current }); setBody(''); setFiles([]); setPicker(false); clientId.current = crypto.randomUUID(); await mutate(); notice(t("Опубликовано ♡")); }); }}><Avatar name={user.displayName} url={user.avatarUrl}/><div><label htmlFor="social-composer">{kind === 'memory' ? t("Что хочется запомнить?") : t("Чем хочется поделиться?")}</label><textarea ref={input} id="social-composer" value={body} onChange={e => setBody(e.target.value)} maxLength={8000} placeholder={t("Маленькая записка или большое спасибо…")} rows={3}/>{picker && <FilePicker selected={files} onChange={setFiles}/>}<div className="wp-social-compose-footer"><Button icon="file" onClick={() => setPicker(v => !v)}>{t("Материалы")}{files.length ? ' (' + files.length + ')' : ''}</Button><Button type="submit" className="wp-primary" disabled={action.busy || (!body.trim() && !files.length)}>{action.busy ? t("Публикуем…") : t("Опубликовать")}</Button></div>{action.error && <ErrorBox error={new Error(action.error)}/>}</div></form>{error && <ErrorBox error={error} retry={() => void mutate()}/>} {isLoading ? <Loading /> : !posts.length ? <Empty title={kind === 'memory' ? t("У нашей истории пока чистый лист") : t("Первое послание ждёт вас")}><p>{t("Напишите пару строк или прикрепите фотографию из облака.")}</p></Empty> : <div className="wp-social-stream">{posts.map(p => <PostCard key={p.id} post={p} user={user} onPreview={onPreview} refresh={async () => { await refresh(() => true); }}/>)}</div>}<div ref={sentinel}/>{more && <Button disabled={isValidating} onClick={() => void setSize(size + 1)}>{isValidating ? t("Загружаем…") : t("Загрузить ещё")}</Button>}</div><aside className="wp-social-aside"><h2>{t("Между нами")}</h2><p>{t("Только ваши публикации, сердечки и ответы. Новые истории синхронизируются между вами.")}</p><a href="#albums">{t("Наши альбомы")}</a><a href="#planner">{t("Планы на выходные")}</a><a href="#wishes">{t("Идеи подарков ♡")}</a></aside></div></>;
}
function PostCard({ post: p, user, onPreview, refresh }: {
    post: Post;
    user: User;
    onPreview: (f: CloudFile) => void;
    refresh: () => Promise<void>;
}) {
    const { t } = useI18n();
    const [repliesOpen, setRepliesOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState('');
    const [index, setIndex] = useState(0);
    const action = useAction();
    const clientId = useRef(crypto.randomUUID());
    const { data: replies, error, mutate } = useSWR<Post[]>(repliesOpen ? `/posts/${p.id}/replies` : null, api);
    const allFiles = p.files || [];
    const shown = p.kind === 'memory' ? allFiles.slice(Math.min(index, Math.max(0, allFiles.length - 1)), Math.min(index, Math.max(0, allFiles.length - 1)) + 1) : allFiles;
    return <article className="wp-social-post" aria-label={t("Публикация ") + p.authorName}>{p.pinned && <div className="wp-pinned">{t("♡ Закреплённое послание")}</div>}<header className="wp-social-author"><Avatar name={p.authorName} url={p.authorAvatarUrl}/><div><strong>{p.authorName}</strong><small>{date(p.createdAt, true)}{t(" · только для нас")}</small></div></header><p>{p.body}</p>{shown.length > 0 && <div className="wp-social-media">{shown.map(f => <button type="button" key={f.id} onClick={() => onPreview(f)} aria-label={t("Открыть ") + f.name}><Thumb file={f}/></button>)}</div>}{p.kind === 'memory' && allFiles.length > 1 && <div className="wp-carousel-controls"><span>{index + 1}{t(" из ")}{allFiles.length}</span><div><Button onClick={() => setIndex(i => (i + allFiles.length - 1) % allFiles.length)} aria-label={t("Предыдущее фото")}>‹</Button><Button onClick={() => setIndex(i => (i + 1) % allFiles.length)} aria-label={t("Следующее фото")}>›</Button></div></div>}<footer className="wp-social-meta"><Button icon="heart" aria-label={p.liked ? t("Убрать сердечко") : t("Поставить сердечко")} aria-pressed={p.liked} disabled={action.busy} onClick={e => { if (!p.liked)
        burst(e.currentTarget); void action.run(async () => { await api(`/posts/${p.id}/heart`, p.liked ? 'DELETE' : 'PUT'); await refresh(); }); }}>{p.heartCount}</Button><Button icon="reply" aria-expanded={repliesOpen} onClick={() => setRepliesOpen(v => !v)}>{t("Ответы: ")}{p.replyCount}</Button><ActionButton action={async () => { await api(`/posts/${p.id}`, 'PATCH', { pinned: !p.pinned }); await refresh(); }}>{p.pinned ? t("Открепить") : t("Закрепить")}</ActionButton>{p.authorId === user.id && <Button className="wp-text" onClick={() => setEditing(true)}>{t("Изменить")}</Button>}</footer>{action.error && <ErrorBox error={new Error(action.error)}/>} {repliesOpen && <section className="wp-replies" aria-label={t("Ответы на публикацию")}>{error && <ErrorBox error={error}/>} {replies?.map(r => <article className="wp-reply" key={r.id}><Avatar name={r.authorName} url={r.authorAvatarUrl}/><strong>{r.authorName}</strong><small>{date(r.createdAt, true)}</small><p>{r.body}</p><ActionButton icon="heart" className="wp-text" aria-pressed={r.liked} action={async () => { await api(`/posts/${r.id}/heart`, r.liked ? 'DELETE' : 'PUT'); await mutate(); }}>{r.heartCount}</ActionButton>{r.authorId === user.id && <ActionButton className="wp-text" action={async () => { if (!confirm(t("Удалить этот ответ?")))
        return; await api(`/posts/${r.id}`, 'DELETE'); await mutate(); await refresh(); }}>{t("Удалить")}</ActionButton>}</article>)}<form className="wp-reply-form" onSubmit={e => { e.preventDefault(); void action.run(async () => { await api(`/posts/${p.id}/replies`, 'POST', { body: text.trim(), clientPostId: clientId.current }); clientId.current = crypto.randomUUID(); setText(''); await mutate(); await refresh(); }); }}><label className="wp-sr-only" htmlFor={'reply-' + p.id}>{t("Ваш ответ")}</label><input id={'reply-' + p.id} required value={text} onChange={e => setText(e.target.value)} maxLength={8000} placeholder={t("Написать ответ…")}/><Button icon="send" type="submit" className="wp-primary" disabled={action.busy || !text.trim()}>{t("Ответить")}</Button></form></section>}{editing && <Dialog title={t("Изменить послание")} onClose={() => setEditing(false)}><form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void action.run(async () => { await api('/posts/' + p.id, 'PATCH', { body: data.get('body') }); setEditing(false); await refresh(); }); }}><Field label={t("Текст")}><textarea name="body" defaultValue={p.body} maxLength={8000} rows={7} required/></Field>{action.error && <ErrorBox error={new Error(action.error)}/>}<Footer busy={action.busy} label={t("Сохранить")} onCancel={() => setEditing(false)}/><ActionButton icon="trash" action={async () => { if (!confirm(t("Удалить публикацию? Исходные файлы сохранятся.")))
        return; await api('/posts/' + p.id, 'DELETE'); setEditing(false); await refresh(); }}>{t("Удалить публикацию")}</ActionButton></form></Dialog>}</article>;
}

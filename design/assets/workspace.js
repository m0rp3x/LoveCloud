/* LoveCloud workspace. Berry v3 interactions; fictional memory-only demo, no API/storage/uploads. */
(() => {
  'use strict';
  const main = document.querySelector('[data-workspace-panel]');
  if (!main) return;
  const details = document.querySelector('[data-details-panel]');
  const tree = document.querySelector('[data-folder-tree]');
  const globalSearch = document.querySelector('[data-global-search]');
  const status = document.querySelector('[data-demo-status]');
  const isBerry = document.body.dataset.theme === 'berry';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = '2026-10-17';
  const names = {cloud:'Наше облако',recent:'Недавние',favorites:'Избранное',albums:'Альбомы',feed:'Воспоминания',messages:'Послания',planner:'Общий планнер',wishes:'Вишлисты',vault:'Личное',trash:'Корзина',activity:'Активность'};
  const pluralRules = new Intl.PluralRules('ru-RU');
  const numberFormat = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  const plural = (n,forms) => forms[({one:0,few:1,many:2})[pluralRules.select(n)] ?? 2];
  const quantity = (n,forms) => `${n} ${plural(n,forms)}`;
  const owners = ['Аня','Миша','Вместе'];
  const priorities = {high:'Высокий',normal:'Обычный',low:'Низкий'};
  const stages = {todo:'Запланировано',doing:'В процессе',done:'Готово'};
  const repetitions = {none:'Не повторяется',daily:'Каждый день',weekly:'Каждую неделю',monthly:'Каждый месяц'};
  const money = n => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n);
  const date = (d, options = {day:'numeric',month:'short'}) => d ? new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`)) : 'Без срока';
  const uid = prefix => `${prefix}-${++counter}`;
  let counter = 100;
  const paths = {
    folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    photo:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    heart:'<path d="m12 21-8.7-8.5a5.6 5.6 0 0 1 7.9-7.9l.8.9.8-.9a5.6 5.6 0 0 1 7.9 7.9Z"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',
    plus:'<path d="M12 4v16M4 12h16"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
    lock:'<rect x="4" y="10" width="16" height="12" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4m4 5v3"/>',
    eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6m10-6v6M3 11h18M7 15h3m4 0h3"/>',
    gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13m0-13H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z"/>',
    music:'<path d="M9 18V5l12-3v13M9 8l12-3"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="15" rx="3" ry="3"/>',
    video:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m10 8 6 4-6 4Z"/>',
    restore:'<path d="M3 10a9 9 0 1 1 0 5M3 4v6h6m3-3v5l3 2"/>',
    link:'<path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
    mail:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 1 1 21 11.5Z"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  const btn = (text, action, id='', cls='', extra='') => `<button type="button" class="wp-button ${cls}" data-action="${esc(action)}" data-id="${esc(id)}" data-key="${esc(action+':'+id)}" ${extra}>${text}</button>`;
  const ibtn = (name,label,action,id='',extra='') => btn(icon(name),action,id,'wp-icon-button',`aria-label="${esc(label)}" title="${esc(label)}" ${extra}`);
  const badge = (text,cls='') => `<span class="wp-badge ${cls}">${esc(text)}</span>`;
  const empty = (title,text,action='') => `<div class="wp-empty">${icon('folder')}<h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;
  const thumbUrls = ['illustrations/cottage.svg','illustrations/cup.svg','illustrations/daisy-sticker.svg','illustrations/book.svg'];
  const folders = [
    {id:'travel',name:'Наши путешествия',parent:'',note:'Море, города и длинные дороги',color:'peach'},
    {id:'home',name:'Дом и уют',parent:'',note:'Всё для нашего дома',color:'lilac'},
    {id:'photos',name:'Фото вдвоём',parent:'',note:'Любимые кадры',color:'pink'},
    {id:'papers',name:'Документы',parent:'',note:'Билеты, планы и важное',color:'blue'},
    {id:'celebrations',name:'Наши праздники',parent:'',note:'Маленькие и большие поводы',color:'peach'},
    {id:'inspiration',name:'Вдохновение',parent:'',note:'Идеи, рецепты и музыка',color:'sage'},
    {id:'sea',name:'Сентябрь у моря',parent:'travel',note:'Поездка в Сочи',color:'blue'},
    {id:'karelia',name:'Карелия · май',parent:'travel',note:'Лес и озёра',color:'sage'},
  ];
  const fileSeed = [
    ['Море на рассвете.jpg','photo',4.8,'Аня','2026-10-17','',0,true],
    ['Наши планы на осень.pdf','pdf',1.2,'Миша','2026-10-17','',null,true],
    ['Кофе у окна.jpg','photo',3.6,'Аня','2026-10-16','',2,false],
    ['Поездка в Сочи.mp4','video',124,'Миша','2026-10-16','',0,false],
    ['Семейный бюджет.xlsx','sheet',0.08,'Вместе','2026-10-15','',null,true],
    ['Список любимых мест.docx','doc',0.24,'Аня','2026-10-15','',null,false],
    ['Воскресный плейлист.mp3','music',8.4,'Миша','2026-10-14','',null,false],
    ['Сосны после дождя.jpg','photo',6.2,'Аня','2026-10-13','',3,true],
    ['Билеты на концерт.pdf','pdf',0.7,'Миша','2026-10-12','',null,false],
    ['Море без фильтров.jpg','photo',5.1,'Миша','2026-10-11','',1,false],
    ['Рецепт тех самых булочек.docx','doc',0.18,'Аня','2026-10-10','',null,false],
    ['Архив поездки.zip','archive',246,'Вместе','2026-10-09','',null,false],
    ['Маршрут по побережью.pdf','pdf',0.9,'Миша','2026-09-14','sea',null,true],
    ['Пляж в семь утра.jpg','photo',4.6,'Аня','2026-09-14','sea',1,true],
    ['Волны и ветер.mp4','video',98,'Миша','2026-09-14','sea',0,false],
    ['Лесная тропинка.jpg','photo',6.1,'Аня','2026-05-11','karelia',3,false],
    ['План книжной полки.pdf','pdf',1.3,'Миша','2026-10-07','home',null,false],
    ['Суббота вместе.jpg','photo',4.2,'Аня','2026-10-03','photos',2,true],
    ['Скан билетов.pdf','pdf',0.3,'Миша','2026-09-25','papers',null,false],
    ['Праздничный букет.jpg','photo',5.8,'Аня','2026-09-22','celebrations',2,false],
    ['Идеи для выходных.docx','doc',0.2,'Вместе','2026-10-08','inspiration',null,false],
    ['Старая версия маршрута.pdf','pdf',0.4,'Миша','2026-09-10','travel',null,false],
  ];
  const files = fileSeed.map((f,i) => ({id:`f${i+1}`,name:f[0],type:f[1],size:f[2],owner:f[3],modified:f[4],folder:f[5],photo:f[6],favorite:f[7],trash:i===21}));
  const albums = [
    {id:'a1',name:'Сентябрь у моря',subtitle:'Сочи · 14–18 сентября',ids:['f1','f10','f14','f15'],cover:0},
    {id:'a2',name:'Обычные счастливые дни',subtitle:'Наш дом и маленькие радости',ids:['f3','f18','f20'],cover:2},
    {id:'a3',name:'Карелия вдвоём',subtitle:'Май · озёра и сосны',ids:['f8','f16'],cover:3},
  ];
  const tasks = [
    {id:'t1',title:'Выбрать фотографии для альбома',owner:'Аня',due:today,priority:'high',repeat:'none',stage:'doing'},
    {id:'t2',title:'Забронировать столик на годовщину',owner:'Миша',due:'2026-10-18',priority:'high',repeat:'none',stage:'todo'},
    {id:'t3',title:'Заехать за продуктами',owner:'Вместе',due:today,priority:'normal',repeat:'weekly',stage:'todo'},
    {id:'t4',title:'Полить цветы',owner:'Миша',due:'2026-10-16',priority:'normal',repeat:'weekly',stage:'todo'},
    {id:'t5',title:'Разобрать вещи для поездки',owner:'Аня',due:'2026-10-19',priority:'normal',repeat:'none',stage:'doing'},
    {id:'t6',title:'Оплатить интернет',owner:'Миша',due:'2026-10-20',priority:'high',repeat:'monthly',stage:'todo'},
    {id:'t7',title:'Прогулка без телефонов',owner:'Вместе',due:'2026-10-18',priority:'low',repeat:'weekly',stage:'todo'},
    {id:'t8',title:'Купить билеты в театр',owner:'Аня',due:'2026-10-15',priority:'normal',repeat:'none',stage:'done'},
    {id:'t9',title:'Собрать книжную полку',owner:'Вместе',due:'2026-10-14',priority:'low',repeat:'none',stage:'done'},
  ];
  const wishes = [
    {id:'w1',title:'Керамическая чашка ручной работы',owner:'Аня',category:'Для дома',price:2800,priority:'high',url:'https://example.com/ceramics',note:'В молочном цвете, без блюдца',reserved:false,symbol:'☕'},
    {id:'w2',title:'Выходные в домике у озера',owner:'Аня',category:'Впечатления',price:18000,priority:'high',url:'https://example.com/lake',note:'Когда пожелтеет лес',reserved:true,symbol:'⌂'},
    {id:'w3',title:'Альбом для акварели',owner:'Аня',category:'Хобби',price:1400,priority:'normal',url:'https://example.com/art',note:'Хлопковая бумага, небольшой формат',reserved:false,symbol:'✎'},
    {id:'w4',title:'Книга «Сад на подоконнике»',owner:'Аня',category:'Книги',price:1900,priority:'low',url:'https://example.com/book',note:'Бумажное издание с иллюстрациями',reserved:false,symbol:'▤'},
    {id:'w5',title:'Винил для воскресного утра',owner:'Миша',category:'Хобби',price:4200,priority:'high',url:'https://example.com/vinyl',note:'Джаз, издание в хорошем состоянии',reserved:false,symbol:'◉'},
    {id:'w6',title:'Мастер-класс по гончарному делу',owner:'Миша',category:'Впечатления',price:6500,priority:'normal',url:'https://example.com/workshop',note:'Два места, чтобы пойти вместе',reserved:true,symbol:'✿'},
    {id:'w7',title:'Термокружка для поездок',owner:'Миша',category:'Для дома',price:3200,priority:'normal',url:'https://example.com/mug',note:'400 мл, не протекает в рюкзаке',reserved:false,symbol:'♧'},
    {id:'w8',title:'Книга о северной архитектуре',owner:'Миша',category:'Книги',price:3600,priority:'low',url:'https://example.com/design',note:'Для вдохновения перед поездкой',reserved:false,symbol:'▤'},
  ];
  const activities = [
    {who:'Аня',text:'добавила «Море на рассвете.jpg»',when:'Сегодня, 10:24',kind:'photo'},
    {who:'Миша',text:'обновил планы на осень',when:'Сегодня, 09:40',kind:'file'},
    {who:'Аня',text:'собрала альбом «Сентябрь у моря»',when:'Вчера, 20:16',kind:'heart'},
    {who:'Вместе',text:'завершили задачу «Купить билеты в театр»',when:'15 октября, 18:35',kind:'check'},
    {who:'Миша',text:'добавил папку «Дом и уют»',when:'14 октября, 12:10',kind:'folder'},
  ];
  const socialPosts = [
    {id:'p1',from:'Миша',text:'Давайте сохраним здесь всё, что хочется сказать друг другу. Маленькие записки, идеи на выходные и просто «я рядом».\n\nА в субботу — театр. Билеты уже в нашем облаке ♡',time:'Сегодня, 10:12',pinned:true,liked:true,likes:2,media:[],replies:[{from:'Аня',text:'А после театра — в нашу любимую кофейню!',time:'10:15'}]},
    {id:'p2',from:'Аня',text:'Нашла ещё два кадра с моря. Помнишь, как мы решили «ещё пять минут» и остались на весь вечер? Хочу повторить.',time:'Сегодня, 09:40',pinned:false,liked:false,likes:1,media:['f1','f10'],replies:[{from:'Миша',text:'Я уже открыл папку с маршрутами 😊',time:'09:48'}]},
    {id:'p3',from:'Миша',text:'Идея на воскресенье: завтрак дома, прогулка в лесу и никаких срочных дел. Добавил в планнер, но пусть это будет самый необязательный пункт недели.',time:'Вчера, 19:24',pinned:false,liked:false,likes:1,media:['f8'],replies:[]},
    {id:'p4',from:'Аня',text:'Маленькое спасибо за кофе и за то, что помнишь, какую чашку я люблю. Такие обычные вещи делают день особенным ♡',time:'Вчера, 12:05',pinned:false,liked:true,likes:2,media:[],replies:[]},
  ];
  const state = {deskMode:'desk',view:'cloud',folder:'',search:'',sort:'new',layout:document.body.dataset.theme==='rose'?'list':'grid',type:'all',selected:new Set(),planner:'list',assignee:'all',taskStatus:'all',week:'2026-10-12',wishOwner:'Аня',wishCategory:'all',viewer:'Аня',vault:false,album:'',upload:null,carousel:0,replies:new Set()};
  const dialog = document.createElement('dialog');
  dialog.className = 'wp-dialog';
  dialog.setAttribute('aria-labelledby','wp-dialog-title');
  document.body.append(dialog);
  let invoker = null;
  let uploadTimer = null;
  let afterPocketRoute = null;
  let pocket = null;
  let pocketButton = null;
  let pocketMenu = null;
  const notify = text => {if(status) {status.textContent=text;} else {fallbackStatus.textContent=text;}};
  const fallbackStatus = document.createElement('div');
  if (!status) {fallbackStatus.className='wp-status';fallbackStatus.setAttribute('role','status');document.body.append(fallbackStatus);}
  function activity(text,kind='file') {activities.unshift({who:state.viewer,text,when:'Только что · демо',kind});}
  function safeUrl(value) {try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';} catch {return '';}}
  function folderPath(id) {const result=[];const seen=new Set();while(id&&!seen.has(id)) {seen.add(id);const f=folders.find(x=>x.id===id);if(!f)break;result.unshift(f);id=f.parent;}return result;}
  function folderLink(f) {return `<a class="wp-tree-link ${state.folder===f.id&&state.view==='cloud'?'is-active':''}" href="#cloud?folder=${encodeURIComponent(f.id)}">${icon('folder')}<span>${esc(f.name)}</span></a>`;}
  function renderTree() {if(tree)tree.innerHTML=folders.filter(f=>!f.parent).map(f=>`<div class="wp-tree-item">${folderLink(f)}${folders.some(x=>x.parent===f.id)?`<div class="wp-tree-children">${folders.filter(x=>x.parent===f.id).map(folderLink).join('')}</div>`:''}</div>`).join('');}
  function navigate(view,params={}) {const query=new URLSearchParams(params);const next=`#${view}${query.size?'?'+query:''}`;if(location.hash===next)render(true);else location.hash=next;}
  function route() {
    if(location.hash==='#main'){main.querySelector('h1')?.focus({preventScroll:true});return;}
    if(isBerry)closePocket(false);
    const [v,q='']=location.hash.slice(1).split('?');
    const previous=state.view;
    state.view=Object.hasOwn(names,v)?v:'cloud';
    const p=new URLSearchParams(q);
    state.folder=folders.some(f=>f.id===p.get('folder'))?p.get('folder'):'';
    state.search=p.get('q')||'';state.album=p.get('album')||'';state.selected.clear();
    if(state.view!=='vault')state.vault=false;
    if(globalSearch)globalSearch.value=state.search;
    document.body.classList.remove('nav-open');
    document.querySelector('[data-mobile-menu]')?.setAttribute('aria-expanded','false');
    render(document.activeElement!==globalSearch&&(previous!==state.view||Boolean(v)));
    if(afterPocketRoute){const run=afterPocketRoute;afterPocketRoute=null;run();}
  }
  const heading = (title,subtitle='',actions='') => `<header class="wp-page-heading"><div><h1 tabindex="-1">${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><div class="wp-heading-actions">${actions}</div></header>`;
  function render(focusHeading=false) {
    if(isBerry)document.body.dataset.deskMode=state.deskMode;
    const active=document.activeElement;
    const key=active?.dataset.key;
    const inWorkspace=main.contains(active)||details?.contains(active);
    document.querySelectorAll('[data-nav]').forEach(b=>{const yes=b.dataset.nav===state.view;b.classList.toggle('is-active',yes);if(yes)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    document.title=`${names[state.view]} — LoveCloud`;
    const views={cloud:renderCloud,recent:renderCloud,favorites:renderCloud,trash:renderCloud,albums:renderAlbums,feed:renderFeed,messages:renderMessages,planner:renderPlanner,wishes:renderWishes,vault:renderVault,activity:renderActivity};
    main.innerHTML=views[state.view]();
    renderTree();renderDetails();renderUpload();
    if(isBerry){main.insertAdjacentHTML('beforeend','<div class="wp-pocket-space" aria-hidden="true"></div>');details?.insertAdjacentHTML('beforeend','<div class="wp-pocket-space" aria-hidden="true"></div>');}
    if(focusHeading)main.querySelector('h1')?.focus({preventScroll:true});
    else if(inWorkspace&&key) {const replacement=[...document.querySelectorAll('[data-key]')].find(e=>e.dataset.key===key);(replacement||main.querySelector('h1'))?.focus({preventScroll:true});}
  }
  const fileLabel = f => ({photo:'JPG',pdf:'PDF',video:'MP4',sheet:'XLSX',doc:'DOCX',music:'MP3',archive:'ZIP'}[f.type]||'Файл');
  const fileIcon = f => ({photo:'photo',video:'video',music:'music'}[f.type]||'file');
  const fileArt = (f,large=false) => f.photo!==null&&f.photo!==undefined ? `<img src="${thumbUrls[f.photo%thumbUrls.length]}" alt="${esc(f.name)}" width="640" height="420" loading="lazy" class="wp-file-image">${f.type==='video'?`<span class="wp-video-mark">${icon('video')} 01:24</span>`:''}` : `<div class="wp-file-glyph wp-kind-${esc(f.type)} ${large?'wp-file-glyph-large':''}">${icon(fileIcon(f))}<span>${fileLabel(f)}</span></div>`;
  function visibleFiles() {
    let items=files.filter(f=>state.view==='trash'?f.trash:!f.trash);
    if(state.view==='favorites')items=items.filter(f=>f.favorite);
    if(state.view==='cloud'&&!state.search&&!state.album)items=items.filter(f=>f.folder===state.folder);
    if(state.album) {const album=albums.find(a=>a.id===state.album);items=items.filter(f=>album?.ids.includes(f.id));}
    if(state.search) {const q=state.search.toLocaleLowerCase('ru');items=items.filter(f=>f.name.toLocaleLowerCase('ru').includes(q));}
    if(state.type!=='all')items=items.filter(f=>f.type===state.type);
    return [...items].sort((a,b)=>state.sort==='name'?a.name.localeCompare(b.name,'ru'):state.sort==='size'?b.size-a.size:b.modified.localeCompare(a.modified)||a.name.localeCompare(b.name,'ru'));
  }
  function breadcrumbs() {return `<nav class="wp-breadcrumbs" aria-label="Путь папки"><a href="#cloud">Облако</a>${folderPath(state.folder).map(f=>`${icon('chevron')}<a href="#cloud?folder=${encodeURIComponent(f.id)}">${esc(f.name)}</a>`).join('')}</nav>`;}
  function renderCloud() {
    const list=visibleFiles();
    const childFolders=state.view==='cloud'&&!state.album?folders.filter(f=>state.search?f.name.toLocaleLowerCase('ru').includes(state.search.toLocaleLowerCase('ru')):f.parent===state.folder):[];
    const album=albums.find(a=>a.id===state.album);
    const title=state.search?`Поиск: ${state.search}`:album?.name||folderPath(state.folder).at(-1)?.name||names[state.view];
    const subtitle=state.search?'Результаты по всему общему облаку':state.view==='trash'?'Демо-корзина · восстановите материалы в исходную папку':state.view==='recent'?'Все материалы по дате изменения':state.view==='favorites'?'Всё, что хочется держать под рукой':`${quantity(files.filter(f=>!f.trash).length,['файл','файла','файлов'])} · общее пространство Ани и Миши`;
    const selected=state.selected.size;
    const deskSwitch=isBerry?`<div class="wp-desk-switch" role="group" aria-label="Способ смотреть материалы">${btn(icon('heart')+' Живой стол','desk-mode','desk','',`aria-pressed="${state.deskMode==='desk'}"`)}${btn(icon('list')+' Каталог','desk-mode','catalog','',`aria-pressed="${state.deskMode==='catalog'}"`)}<span class="wp-desk-hint">${state.deskMode==='desk'?'Те же файлы, немного больше жизни ♡':'Все материалы по порядку'}</span></div>`:'';
    return `${state.view==='cloud'?breadcrumbs():''}${heading(title,subtitle,`${btn(icon('folder')+' Новая папка','new-folder')}${btn(icon('upload')+' Загрузить','upload','','wp-primary')}`)}
      ${deskSwitch}<div class="wp-toolbar"><div class="wp-filter-group"><label class="wp-inline-field"><span class="wp-sr-only">Тип файлов</span><select data-filter="file-type"><option value="all">Все типы</option>${[['photo','Фото'],['video','Видео'],['pdf','PDF'],['doc','Документы'],['sheet','Таблицы'],['music','Аудио'],['archive','Архивы']].map(([v,l])=>`<option value="${v}" ${state.type===v?'selected':''}>${l}</option>`).join('')}</select></label><span class="wp-result-count">${quantity(list.length,['файл','файла','файлов'])}${childFolders.length?` и ${quantity(childFolders.length,['папка','папки','папок'])}`:''}</span></div><div class="wp-filter-group"><label class="wp-inline-field"><span class="wp-sr-only">Сортировка</span><select data-filter="file-sort">${[['new','Сначала новые'],['name','По названию'],['size','По размеру']].map(([v,l])=>`<option value="${v}" ${state.sort===v?'selected':''}>${l}</option>`).join('')}</select></label><div class="wp-segment" aria-label="Вид файлов">${ibtn('list','Список','layout','list',`aria-pressed="${state.layout==='list'}"`)}${ibtn('grid','Сетка','layout','grid',`aria-pressed="${state.layout==='grid'}"`)}</div></div></div>
      ${selected?`<div class="wp-selection-bar"><strong>Выбрано: ${selected}</strong><div>${selected===1?btn(icon('eye')+' Просмотр','preview',[...state.selected][0]):''}${isBerry&&state.view!=='trash'?btn(icon('mail')+' Собрать в конверт','new-envelope'):''}${state.view==='trash'?btn(icon('restore')+' Восстановить','restore-selected'):btn(icon('trash')+' В корзину','trash-selected')}${btn('Снять выделение','clear-selection')}</div></div>`:''}
      ${childFolders.length?`<section aria-label="Папки"><div class="wp-section-label"><h2>Папки</h2><span>${childFolders.length}</span></div><div class="wp-folder-grid">${childFolders.map(f=>`<a class="wp-folder-card wp-tone-${f.color||'pink'}" href="#cloud?folder=${encodeURIComponent(f.id)}">${icon('folder')}<div><strong>${esc(f.name)}</strong><small>${quantity(files.filter(x=>!x.trash&&x.folder===f.id).length,['файл','файла','файлов'])}${folders.some(x=>x.parent===f.id)?' · '+quantity(folders.filter(x=>x.parent===f.id).length,['папка','папки','папок']):''}</small></div>${icon('chevron')}</a>`).join('')}</div></section>`:''}
      <section aria-label="Файлы"><div class="wp-section-label"><h2>${album?'Материалы альбома':'Файлы'}</h2>${state.search?btn('Сбросить поиск','clear-search','','wp-text'):badge('Доступно только паре')}</div>${list.length?((!isBerry||state.deskMode==='catalog')&&state.layout==='list'?fileTable(list):fileGrid(list)):empty(state.view==='trash'?'Корзина пуста':'Ничего не найдено',state.search?'Попробуйте другое название или сбросьте фильтр.':'Измените фильтр или добавьте демонстрационный файл.',btn('Сбросить фильтры','reset-files'))}</section>`;
  }
  function fileGrid(list) {return `<div class="wp-file-grid">${list.map(f=>`<article class="wp-file-card ${state.selected.has(f.id)?'is-selected':''}"><div class="wp-file-card-top"><label class="wp-check-target"><input type="checkbox" data-select-file="${f.id}" ${state.selected.has(f.id)?'checked':''} aria-label="Выбрать ${esc(f.name)}"></label>${ibtn('heart',f.favorite?'Убрать из избранного':'Добавить в избранное','favorite',f.id,`aria-pressed="${f.favorite}"`)}</div><button type="button" class="wp-thumbnail" data-action="preview" data-id="${f.id}" aria-label="Просмотр ${esc(f.name)}">${fileArt(f)}</button><div class="wp-file-card-body">${btn(esc(f.name),'select',f.id,'wp-file-name')}<div class="wp-file-subline"><span>${fileLabel(f)} · ${numberFormat.format(f.size)} МБ</span><span>${date(f.modified)}</span></div><div class="wp-file-owner"><span class="wp-avatar wp-avatar-small">${esc(f.owner[0])}</span>${esc(f.owner)}${ibtn('info','Сведения о файле','select',f.id)}</div></div></article>`).join('')}</div>`;}
  function fileTable(list) {return `<div class="wp-table-scroll" tabindex="0" role="region" aria-label="Таблица файлов, прокручивается по горизонтали"><table class="wp-file-table"><thead><tr><th scope="col"><span class="wp-sr-only">Выбрать</span></th><th scope="col">Название</th><th scope="col">Автор</th><th scope="col">Изменён</th><th scope="col">Размер</th><th scope="col"><span class="wp-sr-only">Действия</span></th></tr></thead><tbody>${list.map(f=>`<tr class="${state.selected.has(f.id)?'is-selected':''}"><td><label class="wp-check-target"><input type="checkbox" data-select-file="${f.id}" ${state.selected.has(f.id)?'checked':''} aria-label="Выбрать ${esc(f.name)}"></label></td><td><div class="wp-name-cell"><span class="wp-table-type wp-kind-${f.type}">${icon(fileIcon(f))}</span>${btn(esc(f.name),'select',f.id,'wp-file-name')}${f.favorite?'<span class="wp-heart-mark" aria-label="В избранном">♥</span>':''}</div></td><td><span class="wp-owner-label"><span class="wp-avatar wp-avatar-small">${esc(f.owner[0])}</span>${esc(f.owner)}</span></td><td>${date(f.modified)}</td><td>${numberFormat.format(f.size)} МБ</td><td><div class="wp-row-actions">${ibtn('eye','Просмотр '+f.name,'preview',f.id)}${state.view==='trash'?ibtn('restore','Восстановить файл','restore',f.id):ibtn('heart',f.favorite?'Убрать из избранного':'В избранное','favorite',f.id,`aria-pressed="${f.favorite}"`)}</div></td></tr>`).join('')}</tbody></table></div>`;}
  function renderAlbums() {return `${heading('Общие альбомы','Фотографии из облака, собранные в истории',btn(icon('plus')+' Создать альбом','new-album','','wp-primary'))}<div class="wp-album-grid">${albums.map(a=>`<a class="wp-album-card" href="#cloud?album=${a.id}"><img src="${thumbUrls[a.cover]}" width="640" height="420" loading="lazy" alt="${esc(a.name)}"><div><h2>${esc(a.name)}</h2><p>${esc(a.subtitle)}</p><span>${quantity(a.ids.filter(id=>files.some(f=>f.id===id&&!f.trash)).length,['материал','материала','материалов'])} ${icon('chevron')}</span></div></a>`).join('')}</div><p class="wp-footnote">Альбомы используют исходные файлы облака без копий.</p>`;}
  function renderFeed() {
    const ids=['f1','f10','f14'];const f=files.find(x=>x.id===ids[state.carousel]);
    return `${heading('Воспоминания','Наш дневник · те же материалы, что и в облаке',btn(icon('plus')+' Добавить запись','new-memory','','wp-primary'))}<div class="wp-feed-layout"><div class="wp-feed-stream"><article class="wp-memory"><header><span class="wp-avatar">А</span><div><strong>Аня</strong><small>14 сентября · Сочи</small></div>${badge('3 фотографии')}</header><h2>Тот самый день у моря</h2><p>Проснулись раньше будильника и пошли к воде. Сохраняю этот свет и наш завтрак на пустой набережной.</p><button class="wp-memory-photo" type="button" data-action="preview" data-id="${f.id}" aria-label="Открыть фото ${state.carousel+1} из 3">${fileArt(f)}</button><div class="wp-carousel-controls"><span aria-live="polite">${state.carousel+1} из 3</span><div>${btn('‹','slide','-1','wp-icon-button','aria-label="Предыдущее фото"')}${btn('›','slide','1','wp-icon-button','aria-label="Следующее фото"')}</div></div><footer>${btn(icon('heart')+' Сохранить в избранное','favorite',f.id,'wp-text',`aria-pressed="${f.favorite}"`)}<a href="#cloud?folder=sea">Открыть папку</a></footer></article><article class="wp-memory"><header><span class="wp-avatar">М</span><div><strong>Миша</strong><small>11 октября · дома</small></div></header><h2>Книжная полка наконец на месте</h2><p>Сначала перепутали две детали. Потом нашли инструкцию. Теперь осталось расставить книги — задача уже в нашем планнере.</p><footer><a href="#planner">Посмотреть наши дела</a>${badge('Заметка')}</footer></article><div data-demo-memories>${demoMemories.map(m=>`<article class="wp-memory"><header><span class="wp-avatar">А</span><div><strong>${esc(state.viewer)}</strong><small>Только что · демо</small></div></header><h2>${esc(m.title)}</h2><p>${esc(m.text)}</p></article>`).join('')}</div></div><aside class="wp-feed-summary"><h2>В этом месяце</h2><div class="wp-stat-number">12 <span>маленьких историй</span></div><p>Фотографии, заметки и наши обычные дни.</p><a href="#albums">Все альбомы ${icon('chevron')}</a><div class="wp-divider"></div><h3>Ближайший план</h3><p>Театр в субботу</p><a href="#planner">Открыть планнер</a></aside></div>`;
  }
  const demoMemories=[];
  function renderMessages() {
    const postCards=[...socialPosts].sort((a,b)=>Number(b.pinned)-Number(a.pinned)).map(p=>`<article class="wp-social-post" aria-label="Публикация ${esc(p.from)}">${p.pinned?'<div class="wp-pinned">♧ Закреплённое послание</div>':''}<header class="wp-social-author"><span class="wp-avatar">${esc(p.from[0])}</span><div><strong>${esc(p.from)}</strong><small>${esc(p.time)} · только для нас</small></div></header><p>${esc(p.text)}</p>${p.media.length?`<div class="wp-social-media">${p.media.map(id=>files.find(f=>f.id===id&&!f.trash)).filter(Boolean).map(f=>`<button type="button" data-action="preview" data-id="${f.id}" aria-label="Открыть ${esc(f.name)}">${fileArt(f)}</button>`).join('')}</div>`:''}<footer class="wp-social-meta">${btn(icon('heart')+' '+p.likes,'post-like',p.id,'',`aria-label="${p.liked?'Убрать сердечко':'Поставить сердечко'}" aria-pressed="${p.liked}"`)}${btn(icon('mail')+' Ответы '+p.replies.length,'post-replies',p.id,'',`aria-expanded="${state.replies.has(p.id)}"`)}${btn(p.pinned?'Открепить':'Закрепить','post-pin',p.id,'wp-text')}<span>Общая лента пары</span></footer>${state.replies.has(p.id)?`<section class="wp-replies" aria-label="Ветка ответов">${p.replies.map(r=>`<article class="wp-reply"><strong>${esc(r.from)}</strong><small>${esc(r.time)}</small><p>${esc(r.text)}</p></article>`).join('')}<form class="wp-reply-form" data-form="reply" data-post-id="${p.id}"><label class="wp-sr-only" for="reply-${p.id}">Ответить на послание ${esc(p.from)}</label><input id="reply-${p.id}" name="text" required maxlength="1000" placeholder="Написать ответ…"><button class="wp-button wp-primary" type="submit" aria-label="Опубликовать ответ">${icon('send')}<span>Ответить</span></button></form></section>`:''}</article>`).join('');
    return `${heading('Послания','Наша маленькая социальная лента',badge('Аня + Миша ♡'))}<div class="wp-social-layout"><div class="wp-social-main"><p class="wp-social-notice">Локальное демо: публикации, реакции и ответы видны только в этой вкладке. Настоящая передача ещё не подключена.</p><form class="wp-social-compose" data-form="post"><span class="wp-avatar">${esc(state.viewer[0])}</span><div><label for="wp-post-text">Чем хочется поделиться?</label><textarea id="wp-post-text" name="text" required maxlength="2000" rows="3" placeholder="Маленькая записка, большое спасибо или план на выходные…"></textarea><div class="wp-social-compose-footer"><label class="wp-inline-field"><span class="wp-sr-only">Медиа из облака</span><select name="media"><option value="">Без вложений</option><option value="f1">Фото с моря</option><option value="f1,f10">Два любимых кадра</option><option value="f8">Прогулка в лесу</option></select></label><button class="wp-button wp-primary" type="submit">${icon('send')} Опубликовать</button></div></div></form><div class="wp-social-stream">${postCards}</div></div><aside class="wp-social-aside"><h2>Между нами</h2><p>Записки, фотографии и всё, что хочется сказать. Здесь нет случайных читателей — только вы двое.</p><div class="wp-divider"></div><a href="#albums">Наши общие альбомы</a><a href="#planner">Планы на выходные</a><a href="#wishes">Идеи подарков ♡</a><p>Сердечки и ответы остаются рядом с публикацией.</p></aside></div>`;
  }
  function filteredTasks() {return tasks.filter(t=>(state.assignee==='all'||t.owner===state.assignee)&&(state.taskStatus==='all'||(state.taskStatus==='done'?t.stage==='done':t.stage!=='done'))).sort((a,b)=>a.due.localeCompare(b.due));}
  function taskCard(t) {return `<article class="wp-task ${t.stage==='done'?'is-done':''}"><div class="wp-task-top">${ibtn('check',t.stage==='done'?'Вернуть задачу в план':'Завершить задачу','task-complete',t.id,`aria-pressed="${t.stage==='done'}"`)}<h3>${esc(t.title)}</h3></div><div class="wp-task-meta">${badge(priorities[t.priority],`wp-priority-${t.priority}`)}<span class="wp-owner-label"><span class="wp-avatar wp-avatar-small">${esc(t.owner[0])}</span>${esc(t.owner)}</span></div><div class="wp-task-bottom"><span class="${t.due<today&&t.stage!=='done'?'wp-overdue':''}">${icon('calendar')} ${date(t.due)}${t.due<today&&t.stage!=='done'?' · просрочено':''}</span><label><span class="wp-sr-only">Статус задачи ${esc(t.title)}</span><select data-task-stage="${t.id}" data-key="stage:${t.id}">${Object.entries(stages).map(([v,l])=>`<option value="${v}" ${t.stage===v?'selected':''}>${l}</option>`).join('')}</select></label></div>${t.repeat!=='none'?`<p class="wp-task-repeat">${icon('restore')} ${repetitions[t.repeat]}</p>`:''}</article>`;}
  function shiftDay(d,days) {const value=new Date(`${d}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
  function renderPlanner() {
    const list=filteredTasks();
    const toolbar=`<div class="wp-toolbar"><div class="wp-segment" aria-label="Вид планнера">${[['list','Список'],['week','Неделя'],['kanban','Канбан']].map(([v,l])=>btn(l,'planner-view',v,'',`aria-pressed="${state.planner===v}"`)).join('')}</div><div class="wp-filter-group"><label class="wp-inline-field"><span class="wp-sr-only">Ответственный</span><select data-filter="assignee"><option value="all">Все участники</option>${owners.map(o=>`<option ${state.assignee===o?'selected':''}>${o}</option>`).join('')}</select></label><label class="wp-inline-field"><span class="wp-sr-only">Завершённость задач</span><select data-filter="task-status">${[['all','Все задачи'],['active','Открытые'],['done','Завершённые']].map(([v,l])=>`<option value="${v}" ${state.taskStatus===v?'selected':''}>${l}</option>`).join('')}</select></label></div></div>`;
    let content='';
    if(state.planner==='kanban') content=`<div class="wp-kanban">${Object.entries(stages).map(([v,l])=>`<section class="wp-kanban-column"><h2><span class="wp-stage-dot wp-stage-${v}"></span>${l}<span>${list.filter(t=>t.stage===v).length}</span></h2>${list.filter(t=>t.stage===v).map(taskCard).join('')||'<p class="wp-column-empty">Здесь пока нет задач</p>'}${btn(icon('plus')+' Добавить','new-task',v,'wp-text')}</section>`).join('')}</div>`;
    else if(state.planner==='week') {const days=Array.from({length:7},(_,i)=>shiftDay(state.week,i));content=`<div class="wp-week-heading"><div>${btn('‹','week-shift','-7','wp-icon-button','aria-label="Предыдущая неделя"')}${btn('Сегодня','week-today')}${btn('›','week-shift','7','wp-icon-button','aria-label="Следующая неделя"')}</div><strong>${date(days[0])} – ${date(days[6])} 2026</strong></div><div class="wp-week-scroll" tabindex="0" role="region" aria-label="Неделя, прокручивается по горизонтали"><div class="wp-week">${days.map(d=>`<section class="wp-week-day ${d===today?'is-today':''}"><h2>${date(d,{weekday:'short'})}<strong>${date(d,{day:'numeric'})}</strong></h2>${list.filter(t=>t.due===d).map(taskCard).join('')||'<p class="wp-column-empty">Свободный день ♡</p>'}${ibtn('plus','Добавить задачу на '+date(d),'new-task-date',d)}</section>`).join('')}</div></div>`;}
    else content=list.length?`<div class="wp-task-list">${list.map(taskCard).join('')}</div>`:empty('Задач пока нет','Смените фильтр или запланируйте первое дело.',btn('Добавить задачу','new-task','','wp-primary'));
    return `${heading('Наши дела','17 октября, суббота · демонстрационная неделя',btn(icon('plus')+' Добавить задачу','new-task','','wp-primary'))}<div class="wp-planner-summary"><span><strong>${tasks.filter(t=>t.stage!=='done').length}</strong> открыто</span><span><strong>${tasks.filter(t=>t.due===today&&t.stage!=='done').length}</strong> на сегодня</span><span><strong>${tasks.filter(t=>t.stage==='done').length}</strong> завершено</span>${badge('Вместе легче ♡')}</div>${toolbar}${content}`;
  }
  function renderWishes() {
    const list=wishes.filter(w=>w.owner===state.wishOwner&&(state.wishCategory==='all'||state.wishCategory===w.category));
    const isPartner=state.viewer!==state.wishOwner;
    return `${heading('Вишлисты друг другу','Идеи подарков, маленьких радостей и общих впечатлений',btn(icon('plus')+' Добавить желание','new-wish','','wp-primary'))}<div class="wp-wish-demo">${icon('gift')}<p>Демо-просмотр от имени <strong>${esc(state.viewer)}</strong>. Резерв видит только партнёр. Всё хранится в памяти вкладки; в установленном приложении приватность проверяется API. Здесь это имитация, не защита.</p><label><span class="wp-sr-only">Посмотреть от имени</span><select data-filter="viewer">${owners.slice(0,2).map(o=>`<option ${state.viewer===o?'selected':''}>${o}</option>`).join('')}</select></label></div><div class="wp-toolbar"><div class="wp-segment" aria-label="Чей вишлист">${owners.slice(0,2).map(o=>btn(`Желания ${o==='Аня'?'Ани':'Миши'}`,'wish-owner',o,'',`aria-pressed="${state.wishOwner===o}"`)).join('')}</div><label class="wp-inline-field"><span class="wp-sr-only">Категория желаний</span><select data-filter="wish-category"><option value="all">Все категории</option>${['Для дома','Впечатления','Хобби','Книги','Другое'].map(c=>`<option ${state.wishCategory===c?'selected':''}>${c}</option>`).join('')}</select></label></div><div class="wp-wish-summary"><span>${quantity(list.length,['желание','желания','желаний'])}</span><span>Стоимость желаний ${money(list.reduce((sum,w)=>sum+w.price,0))}</span>${badge(isPartner?'Можно выбрать подарок':'Ваши желания')}</div><div class="wp-wish-grid">${list.map(w=>`<article class="wp-wish-card"><div class="wp-wish-art wp-wish-${w.category==='Впечатления'?'trip':w.category==='Книги'?'book':'home'}"><span aria-hidden="true">${esc(w.symbol)}</span>${badge(w.category)}</div><div class="wp-wish-body"><div class="wp-wish-priority">${badge(priorities[w.priority],`wp-priority-${w.priority}`)}</div><h2>${esc(w.title)}</h2><p>${esc(w.note)}</p><strong class="wp-price">${money(w.price)}</strong><div class="wp-wish-links">${safeUrl(w.url)?`<a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${icon('link')} Демо-ссылка</a>`:''}<span>${esc(w.owner)}</span></div>${isPartner?btn(w.reserved?icon('check')+' В вашем резерве':icon('gift')+' Зарезервировать демо','reserve',w.id,w.reserved?'wp-reserved':'wp-primary',`aria-pressed="${w.reserved}"`):'<div class="wp-private-note">Резерв партнёра здесь не отображается</div>'}</div></article>`).join('')||empty('Пока нет желаний','Добавьте идею в эту категорию.',btn('Добавить желание','new-wish'))}</div><p class="wp-footnote">Примерные цены · ссылки ведут на example.com и не являются рекомендациями магазинов.</p>`;
  }
  function renderVault() {return `${heading('Личное','Общий раздел пары · отдельный вход каждого партнёра',badge('Макет без реальной защиты'))}${state.vault?`<div class="wp-vault-unlocked"><div class="wp-vault-info">${icon('lock')}<div><h2>Демонстрационный раздел открыт</h2><p>Только безопасные пустые папки. Никаких личных материалов и настоящей защиты.</p></div>${btn('Закрыть раздел','vault-lock')}</div><div class="wp-folder-grid">${['Наше личное','Письма для двоих','Особенные даты'].map(n=>`<div class="wp-folder-card">${icon('folder')}<div><strong>${n}</strong><small>Пустая демо-папка</small></div></div>`).join('')}</div></div>`:`<section class="wp-vault-gate"><div class="wp-lock-art">${icon('lock')}<span aria-hidden="true">♡</span></div><div><h2>Дополнительный вход</h2><p>В будущем: код из Google Authenticator или совместимого TOTP-приложения. Это не Google OAuth.</p><form data-form="vault"><label for="wp-totp">Код из 6 цифр</label><input id="wp-totp" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required aria-describedby="wp-vault-warning" placeholder="000000"><p id="wp-vault-warning" class="wp-footnote">Демо проверяет только формат. Демонстрационный код: 123456. Он открывает пустой макет. Не вводите настоящий код.</p><button type="submit" class="wp-button wp-primary">${icon('lock')} Открыть демо</button></form></div></section>`}`;}
  function renderActivity() {return `${heading('История активности','Общее облако, альбомы и задачи · без личного и подарочных резервов')}<div class="wp-activity-list">${activities.map(a=>`<article class="wp-activity-item"><span class="wp-activity-icon">${icon(a.kind)}</span><div><p><strong>${esc(a.who)}</strong> ${esc(a.text)}</p><small>${esc(a.when)}</small></div></article>`).join('')}</div>`;}
  function renderDetails() {
    if(!details)return;
    details.classList.add('wp-details');
    const f=files.find(x=>state.selected.has(x.id));
    const header=`<div class="wp-details-title"><h2>${f?'Сведения о файле':'Наше пространство'}</h2>${f?ibtn('close','Закрыть сведения','clear-selection'):icon('heart')}</div>`;
    if(f) details.innerHTML=`${header}<div class="wp-detail-preview">${fileArt(f,true)}</div><h3 class="wp-detail-name">${esc(f.name)}</h3>${badge(fileLabel(f))}<dl class="wp-property-list"><div><dt>Автор</dt><dd>${esc(f.owner)}</dd></div><div><dt>Изменён</dt><dd>${date(f.modified)}</dd></div><div><dt>Размер</dt><dd>${numberFormat.format(f.size)} МБ</dd></div><div><dt>Расположение</dt><dd>${esc(folderPath(f.folder).map(x=>x.name).join(' / ')||'Наше облако')}</dd></div><div><dt>Доступ</dt><dd>Аня и Миша</dd></div><div><dt>Используется</dt><dd>${quantity(albums.filter(a=>a.ids.includes(f.id)).length,['альбом','альбома','альбомов'])}</dd></div></dl><div class="wp-detail-actions">${btn(icon('eye')+' Предпросмотр','preview',f.id,'wp-primary')}${f.trash?btn(icon('restore')+' Восстановить','restore',f.id):btn(icon('heart')+(f.favorite?' Убрать из избранного':' В избранное'),'favorite',f.id,'',`aria-pressed="${f.favorite}"`)}${!f.trash?btn(icon('trash')+' В корзину','trash-one',f.id):''}</div><p class="wp-footnote">Один файл в облаке и альбомах. Сведения демонстрационные.</p>`;
    else details.innerHTML=`${header}<div class="wp-pair-card"><div class="wp-pair-avatars"><span class="wp-avatar">А</span><span class="wp-avatar">М</span><span aria-hidden="true">♡</span></div><h3>Аня и Миша</h3><p>Облако для наших общих дней</p>${badge('Демонстрационные данные')}</div><div class="wp-overview-stats"><div><strong>${files.filter(f=>!f.trash).length}</strong><span>${plural(files.filter(f=>!f.trash).length,['файл','файла','файлов'])}</span></div><div><strong>${albums.length}</strong><span>${plural(albums.length,['альбом','альбома','альбомов'])}</span></div><div><strong>${tasks.filter(t=>t.stage!=='done').length}</strong><span>${plural(tasks.filter(t=>t.stage!=='done').length,['дело','дела','дел'])}</span></div></div><h3 class="wp-small-heading">Ближайшие дела</h3><div class="wp-mini-tasks">${tasks.filter(t=>t.stage!=='done').slice(0,3).map(t=>`<a href="#planner"><span class="wp-mini-check"></span><div>${esc(t.title)}<small>${esc(t.owner)} · ${date(t.due)}</small></div></a>`).join('')}</div><h3 class="wp-small-heading">Последнее событие</h3><p class="wp-detail-event"><strong>${esc(activities[0].who)}</strong> ${esc(activities[0].text)}</p><a class="wp-detail-link" href="#activity">Вся активность ${icon('chevron')}</a><div class="wp-demo-note">Изменения живут в памяти этой вкладки и исчезнут после обновления. Загрузка и отправка имитируются.</div>`;
  }
  const uploadSlot=document.createElement('div');uploadSlot.className='wp-upload-slot';document.body.append(uploadSlot);
  function renderUpload() {const u=state.upload;if(!u) {uploadSlot.innerHTML='';return;}uploadSlot.innerHTML=`<section class="wp-upload-panel" aria-label="Демонстрационная загрузка"><header><strong>${icon('upload')} ${u.done?'Демо-загрузка завершена':'Имитируем загрузку…'}</strong>${ibtn('close',u.done?'Закрыть загрузку':'Отменить демо-загрузку','upload-close')}</header><p>${esc(u.name)}</p><progress max="100" value="${u.progress}" aria-label="Прогресс демонстрационной загрузки">${u.progress}%</progress><small>${u.progress}% · ${u.done?'Добавлено в память вкладки':'Файлы не передаются'}</small></section>`;}
  function openDialog(title,body,cls='') {invoker=document.activeElement;dialog.className=`wp-dialog ${cls}`;dialog.innerHTML=`<header class="wp-dialog-heading"><h2 id="wp-dialog-title">${esc(title)}</h2>${ibtn('close','Закрыть окно','dialog-close')}</header>${body}`;dialog.showModal();}
  function field(label,name,type='text',value='',extra='') {return `<label class="wp-field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
  function selectField(label,name,items,value) {return `<label class="wp-field"><span>${esc(label)}</span><select name="${esc(name)}">${items.map(item=>{const [v,l]=Array.isArray(item)?item:[item,item];return `<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`;}).join('')}</select></label>`;}
  const formEnd = label => `<p class="wp-form-note">Только демо. Изменения исчезнут после обновления страницы.</p><div class="wp-dialog-footer">${btn('Отмена','dialog-close')}<button type="submit" class="wp-button wp-primary">${esc(label)}</button></div></form>`;
  function newTask(stage='todo',due=today) {openDialog('Добавить общее дело',`<form data-form="task">${field('Название задачи','title','text','','required maxlength="140" placeholder="Например, выбрать билеты в театр"')}<div class="wp-form-grid">${selectField('Ответственный','owner',owners,'Вместе')}${field('Срок','due','date',due,'required')}${selectField('Приоритет','priority',Object.entries(priorities),'normal')}${selectField('Повторение','repeat',Object.entries(repetitions),'none')}${selectField('Статус','stage',Object.entries(stages),stage)}</div>${formEnd('Добавить задачу')}`);}
  function newWish() {openDialog('Добавить желание',`<form data-form="wish">${field('Что хочется?','title','text','','required maxlength="140" placeholder="Например, новая книга"')}<div class="wp-form-grid">${selectField('Чей вишлист','owner',owners.slice(0,2),state.viewer)}${selectField('Категория','category',['Для дома','Впечатления','Хобби','Книги','Другое'],'Другое')}${field('Примерная цена, ₽','price','number','2500','min="0" max="10000000" step="1" required')}${selectField('Приоритет','priority',Object.entries(priorities),'normal')}</div>${field('Ссылка (необязательно)','url','url','','maxlength="1000" placeholder="https://example.com/…"')}<label class="wp-field"><span>Подсказка партнёру</span><textarea name="note" maxlength="300" rows="3" placeholder="Цвет, размер или другие детали…"></textarea></label>${formEnd('Добавить желание')}`);}
  function newFolder() {openDialog('Новая демо-папка',`<form data-form="folder">${field('Название папки','name','text','','required maxlength="80" placeholder="Например, наши выходные"')}${selectField('Расположение','parent',[['','Наше облако'],...folders.map(f=>[f.id,folderPath(f.id).map(x=>x.name).join(' / ')])],state.folder)}${formEnd('Создать папку')}`);}
  function newEnvelope() {
    if(!isBerry)return;
    const selected=files.filter(f=>state.selected.has(f.id)&&!f.trash);
    if(!selected.length){notify('Сначала выберите файлы для конверта');return;}
    openDialog('Собрать в конверт',`<form data-form="envelope"><p class="wp-envelope-intro">Создадим папку-конверт и переместим ${quantity(selected.length,['выбранный файл','выбранных файла','выбранных файлов'])}. Альбомы и воспоминания сохранят ссылки на эти же материалы.</p><input type="hidden" name="fileIds" value="${esc(selected.map(f=>f.id).join(','))}">${field('Название конверта','name','text','','required maxlength="80" placeholder="Например, наши октябрьские дни"')}${selectField('Где оставить конверт','parent',[['','Наше облако'],...folders.map(f=>[f.id,folderPath(f.id).map(x=>x.name).join(' / ')])],state.folder)}<ul class="wp-envelope-files">${selected.map(f=>`<li>${icon(fileIcon(f))}<span>${esc(f.name)}</span></li>`).join('')}</ul>${formEnd('Собрать в конверт')}`);
  }
  function setupPocket() {
    if(!isBerry)return;
    pocket=document.createElement('div');pocket.className='wp-pocket';
    pocket.innerHTML=`<div id="wp-pocket-menu" class="wp-pocket-menu" role="menu" aria-label="Что положить на стол?" hidden>${[['memory','heart','Воспоминание'],['post','mail','Послание'],['task','calendar','Дело'],['wish','gift','Желание'],['folder','folder','Папка']].map(([id,i,label])=>btn(icon(i)+`<span>${label}</span>`,'pocket-item',id,'','role="menuitem" tabindex="-1"')).join('')}</div>${btn('<span class="wp-pocket-mark" aria-hidden="true">'+icon('plus')+'</span><span>Положить на стол</span>','pocket-toggle','','wp-pocket-button','aria-haspopup="menu" aria-controls="wp-pocket-menu" aria-expanded="false"')}`;
    document.body.append(pocket);pocketButton=pocket.querySelector('.wp-pocket-button');pocketMenu=pocket.querySelector('.wp-pocket-menu');
  }
  function closePocket(restoreFocus=true) {if(!pocketMenu||pocketMenu.hidden)return;pocketMenu.hidden=true;pocketButton.setAttribute('aria-expanded','false');if(restoreFocus)pocketButton.focus({preventScroll:true});}
  function openPocket(last=false) {if(!pocketMenu)return;pocketMenu.hidden=false;pocketButton.setAttribute('aria-expanded','true');const items=pocketMenu.querySelectorAll('[role="menuitem"]');items[last?items.length-1:0]?.focus({preventScroll:true});}
  function launchPocket(kind) {
    if(!isBerry)return;
    closePocket(false);
    const config={memory:['feed',()=>handleAction('new-memory','',pocketButton)],post:['messages',()=>main.querySelector('#wp-post-text')?.focus()],task:['planner',()=>newTask()],wish:['wishes',()=>newWish()],folder:['cloud',()=>newFolder()]};
    const action=config[kind];if(!action)return;
    const run=()=>{action[1]();if(dialog.open)invoker=pocketButton;};
    if(state.view===action[0])run();else {afterPocketRoute=run;navigate(action[0]);}
  }
  function newAlbum() {openDialog('Новый альбом',`<form data-form="album">${field('Название альбома','name','text','','required maxlength="100" placeholder="Например, осень вдвоём"')}<fieldset class="wp-album-picker"><legend>Фотографии из облака</legend>${files.filter(f=>!f.trash&&f.type==='photo').map(f=>`<label><input type="checkbox" name="files" value="${f.id}"><span>${esc(f.name)}</span></label>`).join('')}</fieldset>${formEnd('Создать альбом')}`);}
  function showUpload() {openDialog('Демонстрационная загрузка',`<form data-form="upload"><div class="wp-upload-demo-art">${icon('upload')}</div><p>Добавим вымышленный файл <strong>«Вечерняя прогулка.jpg»</strong> в текущую папку. Настоящие файлы не выбираются и никуда не передаются.</p>${selectField('Расположение','parent',[['','Наше облако'],...folders.map(f=>[f.id,folderPath(f.id).map(x=>x.name).join(' / ')])],state.folder)}${formEnd('Имитировать загрузку')}`);}
  function preview(id) {const f=files.find(x=>x.id===id);if(!f)return;openDialog(f.name,`<div class="wp-preview-content">${fileArt(f,true)}${f.type==='video'?'<span class="wp-preview-demo-label">Постер демо-видео · воспроизведение не подключено</span>':''}${f.type==='music'?'<p>Демонстрационная аудиозапись. Воспроизведение не подключено.</p>':''}${['pdf','doc','sheet','archive'].includes(f.type)?`<div class="wp-document-sample"><h3>${esc(f.name.replace(/\.[^.]+$/,''))}</h3><p>Демонстрационный предпросмотр</p>${f.type==='sheet'?'<table><caption>Пример бюджета</caption><tr><th>Категория</th><th>Сумма</th></tr><tr><td>Путешествия</td><td>25 000 ₽</td></tr><tr><td>Впечатления</td><td>8 000 ₽</td></tr><tr><td>Дом</td><td>6 000 ₽</td></tr></table>':'<p>Суббота: неспешный завтрак, прогулка у воды и уютный вечер дома. Воскресенье: выбрать фотографии и спланировать следующую поездку.</p><div class="wp-document-lines" aria-hidden="true"></div>'}</div>`:''}</div><footer class="wp-preview-footer"><span>${fileLabel(f)} · ${numberFormat.format(f.size)} МБ · ${esc(f.owner)}</span>${btn(icon('heart')+(f.favorite?' В избранном':' В избранное'),'favorite',f.id,'',`aria-pressed="${f.favorite}"`)}</footer>`,'wp-preview-dialog');}
  function completeTask(t) {const wasDone=t.stage==='done';t.stage=wasDone?'todo':'done';if(!wasDone) {activity(`завершил(а) задачу «${t.title}»`,'check');if(t.repeat!=='none'&&!t.nextCreated){const next={...t,id:uid('t'),stage:'todo',nextCreated:false};if(t.repeat==='monthly') {const d=new Date(`${t.due}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);next.due=d.toISOString().slice(0,10);}else next.due=shiftDay(t.due,t.repeat==='daily'?1:7);tasks.push(next);t.nextCreated=true;notify('Задача завершена. Следующее повторение добавлено в демо-планнер.');}else notify('Задача завершена ♡');}else notify('Задача возвращена в план');render();}
  function restore(ids) {files.filter(f=>ids.includes(f.id)).forEach(f=>f.trash=false);activity('восстановил(а) материалы из корзины','restore');state.selected.clear();notify('Материалы восстановлены в исходные папки');render();}
  function confirmTrash(ids) {openDialog('Переместить в корзину?',`<p>Выбрано материалов: ${ids.length}. Они исчезнут из текущих альбомов и списков. В демо их можно восстановить в разделе «Корзина».</p><div class="wp-dialog-footer">${btn('Отмена','dialog-close')}${btn('Переместить в корзину','trash-confirm',ids.join(','),'wp-primary')}</div>`);}
  function handleAction(action,id,element) {
    switch(action) {
      case 'layout':state.layout=id;if(isBerry)state.deskMode='catalog';render();break;
      case 'desk-mode':if(isBerry&&['desk','catalog'].includes(id)){state.deskMode=id;render();notify(id==='desk'?'Материалы на живом столе ♡':'Открыт спокойный каталог тех же файлов');}break;
      case 'new-envelope':newEnvelope();break;
      case 'pocket-toggle':if(pocketMenu?.hidden)openPocket();else closePocket();break;
      case 'pocket-item':launchPocket(id);break;
      case 'select':state.selected=new Set([id]);render();notify('Выбран файл. Сведения в панели справа или ниже списка.');break;
      case 'clear-selection':state.selected.clear();render();break;
      case 'preview':if(dialog.open)dialog.close();preview(id);break;
      case 'favorite': {const f=files.find(x=>x.id===id);if(!f)break;f.favorite=!f.favorite;if(f.favorite)heartBurst(element);if(dialog.open) {element.setAttribute('aria-pressed',String(f.favorite));element.innerHTML=icon('heart')+(f.favorite?' В избранном':' В избранное');}render();notify(f.favorite?'Добавлено в избранное ♡':'Убрано из избранного');break;}
      case 'post-like': {const p=socialPosts.find(x=>x.id===id);if(!p)break;p.liked=!p.liked;p.likes+=p.liked?1:-1;if(p.liked)heartBurst(element);render();notify(p.liked?'Сердечко добавлено ♡':'Сердечко убрано');break;}
      case 'post-replies':state.replies.has(id)?state.replies.delete(id):state.replies.add(id);render();if(state.replies.has(id))main.querySelector(`#reply-${id}`)?.focus({preventScroll:true});break;
      case 'post-pin': {const p=socialPosts.find(x=>x.id===id);if(p){const pin=!p.pinned;socialPosts.forEach(x=>x.pinned=false);p.pinned=pin;render();notify(pin?'Послание закреплено вверху':'Послание откреплено');}break;}
      case 'new-folder':newFolder();break;
      case 'new-task':newTask(id||'todo');break;
      case 'new-task-date':newTask('todo',id);break;
      case 'new-wish':newWish();break;
      case 'new-album':newAlbum();break;
      case 'upload':showUpload();break;
      case 'dialog-close':dialog.close();break;
      case 'clear-search':navigate('cloud',state.folder?{folder:state.folder}:{});break;
      case 'reset-files':state.type='all';state.sort='new';if(state.search)navigate('cloud');else render();break;
      case 'trash-selected':confirmTrash([...state.selected]);break;
      case 'trash-one':confirmTrash([id]);break;
      case 'trash-confirm':files.filter(f=>id.split(',').includes(f.id)).forEach(f=>f.trash=true);activity('переместил(а) материалы в корзину','trash');state.selected.clear();dialog.close();render();notify('Перемещено в демо-корзину. Доступно восстановление.');break;
      case 'restore':restore([id]);break;
      case 'restore-selected':restore([...state.selected]);break;
      case 'planner-view':state.planner=id;render();break;
      case 'task-complete': {const t=tasks.find(x=>x.id===id);if(t)completeTask(t);break;}
      case 'week-shift':state.week=shiftDay(state.week,Number(id));render();break;
      case 'week-today':state.week='2026-10-12';render();break;
      case 'wish-owner':state.wishOwner=id;state.wishCategory='all';render();break;
      case 'reserve': {const w=wishes.find(x=>x.id===id);if(!w||w.owner===state.viewer)break;w.reserved=!w.reserved;render();notify(w.reserved?'Демо-резерв добавлен. В режиме автора он скрыт.':'Демо-резерв снят');break;}
      case 'slide':state.carousel=(state.carousel+Number(id)+3)%3;render();break;
      case 'vault-lock':state.vault=false;render();notify('Демо-раздел закрыт');break;
      case 'upload-close':clearInterval(uploadTimer);uploadTimer=null;state.upload=null;renderUpload();notify('Панель демонстрационной загрузки закрыта');break;
      case 'new-memory':openDialog('Добавить воспоминание',`<form data-form="memory">${field('Заголовок','title','text','','required maxlength="120"')}<label class="wp-field"><span>Что хочется запомнить?</span><textarea name="text" maxlength="2000" rows="5" required></textarea></label>${formEnd('Добавить запись')}`);break;
    }
  }
  document.addEventListener('click',e=>{
    if(isBerry&&pocketMenu&&!pocketMenu.hidden&&!pocket.contains(e.target))closePocket(false);
    if(e.target.closest('[data-reset-demo]')){window.location.hash='cloud';window.location.reload();return;}
    if(e.target.closest('[data-motion-toggle]')){document.body.classList.toggle('motion-paused');updateMotionToggle();return;}
    const nav=e.target.closest('[data-nav]');if(nav){navigate(nav.dataset.nav);return;}
    if(e.target.closest('[data-mobile-menu]')) {document.body.classList.toggle('nav-open');document.querySelector('[data-mobile-menu]')?.setAttribute('aria-expanded',String(document.body.classList.contains('nav-open')));return;}
    if(e.target.closest('[data-create]')) {state.view==='planner'?newTask():state.view==='wishes'?newWish():newFolder();return;}
    if(e.target.closest('[data-upload]')){showUpload();return;}
    const action=e.target.closest('[data-action]');if(action)handleAction(action.dataset.action,action.dataset.id,action);
  });
  document.addEventListener('change',e=>{
    const el=e.target;
    if(el.matches('[data-select-file]')) {el.checked?state.selected.add(el.dataset.selectFile):state.selected.delete(el.dataset.selectFile);render();const replacement=[...main.querySelectorAll('[data-select-file]')].find(x=>x.dataset.selectFile===el.dataset.selectFile);replacement?.focus({preventScroll:true});}
    if(el.matches('[data-task-stage]')) {const t=tasks.find(x=>x.id===el.dataset.taskStage);if(t){if(el.value==='done'&&t.stage!=='done')completeTask(t);else {t.stage=el.value;activity(`изменил(а) статус задачи «${t.title}»`,'calendar');render();notify('Статус задачи изменён');}}}
    const field=el.dataset.filter;
    const keys={'file-type':'type','file-sort':'sort',assignee:'assignee','task-status':'taskStatus',viewer:'viewer','wish-category':'wishCategory'};
    if(keys[field]) {state[keys[field]]=el.value;const savedValue=el.value;render();[...main.querySelectorAll('[data-filter]')].find(x=>x.dataset.filter===field&&x.value===savedValue)?.focus({preventScroll:true});}
  });
  let searchTimer;
  globalSearch?.addEventListener('input',()=>{clearTimeout(searchTimer);const q=globalSearch.value.trim();searchTimer=setTimeout(()=>navigate('cloud',q?{q}:{}),180);});
  globalSearch?.addEventListener('keydown',e=>{if(e.key==='Escape'){clearTimeout(searchTimer);globalSearch.value='';navigate('cloud');}});
  document.addEventListener('submit',e=>{
    const form=e.target.closest('[data-form]');if(!form)return;e.preventDefault();if(!form.reportValidity())return;
    const fd=new FormData(form);const val=n=>String(fd.get(n)||'').trim();
    for(const input of form.querySelectorAll('[required]')) {if(input.type!=='checkbox'&&!String(input.value).trim()){input.setCustomValidity('Заполните поле');input.reportValidity();input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});return;}}
    switch(form.dataset.form) {
      case 'envelope': {
        if(!isBerry)return;
        const parent=val('parent'),name=val('name');
        if(folders.some(f=>f.parent===parent&&f.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru'))){const input=form.elements.name;input.setCustomValidity('Конверт или папка с таким названием уже есть');input.reportValidity();input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});return;}
        const ids=new Set(val('fileIds').split(','));const moving=files.filter(f=>ids.has(f.id)&&!f.trash);
        if(!moving.length){notify('Выбранные файлы больше недоступны. Выберите другие.');dialog.close();return;}
        const folder={id:uid('folder'),name,parent,note:'Собрано в конверт · демо',color:'pink'};
        folders.push(folder);moving.forEach(f=>{f.folder=folder.id;});state.selected.clear();state.type='all';
        activity(`собрал(а) ${quantity(moving.length,['файл','файла','файлов'])} в конверт «${name}»`,'folder');
        dialog.close();navigate('cloud',{folder:folder.id});notify(`В конверт «${name}» перемещено: ${moving.length}. Ссылки альбомов сохранены.`);break;
      }
      case 'folder': {const parent=val('parent');if(folders.some(f=>f.parent===parent&&f.name.toLocaleLowerCase('ru')===val('name').toLocaleLowerCase('ru'))){const input=form.elements.name;input.setCustomValidity('Папка с таким названием уже есть');input.reportValidity();input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});return;}folders.push({id:uid('folder'),name:val('name'),parent,note:'Новая демо-папка',color:'pink'});activity(`создал(а) папку «${val('name')}»`,'folder');dialog.close();navigate('cloud',parent?{folder:parent}:{});notify('Демо-папка создана');break;}
      case 'task':tasks.push({id:uid('t'),title:val('title'),owner:val('owner'),due:val('due'),priority:val('priority'),repeat:val('repeat'),stage:val('stage')});activity(`добавил(а) задачу «${val('title')}»`,'calendar');dialog.close();render();notify('Задача добавлена в общий демо-планнер');break;
      case 'wish': {const link=val('url');if(link&&!safeUrl(link)){form.elements.url.setCustomValidity('Используйте ссылку https:// или http://');form.elements.url.reportValidity();form.elements.url.addEventListener('input',()=>form.elements.url.setCustomValidity(''),{once:true});return;}const owner=val('owner');wishes.push({id:uid('w'),title:val('title'),owner,category:val('category'),price:Number(val('price')),priority:val('priority'),url:link,note:val('note'),reserved:false,symbol:'♡'});state.wishOwner=owner;state.wishCategory='all';dialog.close();render();notify('Желание добавлено. Резервы не попадают в активность.');break;}
      case 'album': {const ids=fd.getAll('files');if(!ids.length){notify('Выберите хотя бы одну фотографию для альбома');form.querySelector('input[type=checkbox]')?.focus();return;}albums.push({id:uid('a'),name:val('name'),subtitle:'Новый общий альбом · демо',ids,cover:files.find(f=>f.id===ids[0]).photo||0});activity(`создал(а) альбом «${val('name')}»`,'heart');dialog.close();render();notify('Альбом создан без копирования файлов');break;}
      case 'memory':demoMemories.unshift({title:val('title'),text:val('text')});activity('добавил(а) воспоминание','heart');dialog.close();render();notify('Воспоминание добавлено в этой вкладке');break;
      case 'vault':if(val('code')!=='123456'){form.elements.code.setCustomValidity('Для демо введите 123456; настоящий код не нужен');form.elements.code.reportValidity();form.elements.code.addEventListener('input',()=>form.elements.code.setCustomValidity(''),{once:true});return;}state.vault=true;render(true);notify('Открыт пустой демо-раздел, без настоящей защиты');break;
      case 'upload': {const folder=val('parent');dialog.close();clearInterval(uploadTimer);state.upload={name:'Вечерняя прогулка.jpg',progress:0,done:false};renderUpload();notify('Началась имитация загрузки. Настоящие файлы не передаются.');uploadTimer=setInterval(()=>{state.upload.progress=Math.min(100,state.upload.progress+20);if(state.upload.progress===100){clearInterval(uploadTimer);uploadTimer=null;state.upload.done=true;files.unshift({id:uid('f'),name:'Вечерняя прогулка.jpg',type:'photo',size:4.2,owner:state.viewer,modified:today,folder,photo:3,favorite:false,trash:false});activity('добавил(а) вымышленный файл «Вечерняя прогулка.jpg»','upload');render();notify('Демо-файл добавлен в память вкладки');}else renderUpload();},400);break;}
      case 'post':socialPosts.unshift({id:uid('p'),from:state.viewer,text:val('text'),time:'Только что · демо',pinned:false,liked:false,likes:0,media:val('media').split(',').filter(Boolean),replies:[]});render();main.querySelector('#wp-post-text')?.focus({preventScroll:true});notify('Послание опубликовано в демо-ленте этой вкладки');break;
      case 'reply': {const p=socialPosts.find(x=>x.id===form.dataset.postId);if(p){p.replies.push({from:state.viewer,text:val('text'),time:'Только что · демо'});render();main.querySelector(`#reply-${p.id}`)?.focus({preventScroll:true});notify('Ответ добавлен в ветку этой вкладки');}break;}
    }
  });
  function updateMotionToggle() {const paused=document.body.classList.contains('motion-paused');document.querySelectorAll('[data-motion-toggle]').forEach(b=>{b.setAttribute('aria-pressed',String(paused));b.setAttribute('aria-label',paused?'Включить анимации':'Приостановить анимации');b.title=paused?'Включить анимации':'Приостановить анимации';const label=b.querySelector('[data-motion-label]');if(label)label.textContent=paused?'Анимации на паузе':'Анимации включены';});notify(paused?'Анимации приостановлены':'Анимации включены. Reduced-motion учитывается автоматически.');}
  function heartBurst(element) {if(document.body.classList.contains('motion-paused')||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const r=element.getBoundingClientRect();for(let i=0;i<7;i++){const h=document.createElement('span');h.className='wp-heart-burst';h.setAttribute('aria-hidden','true');h.textContent=i%2?'♡':'♥';h.style.left=`${r.left+r.width/2}px`;h.style.top=`${r.top}px`;h.style.setProperty('--drift',`${(i-3)*19}px`);h.style.setProperty('--turn',`${(i-3)*15}deg`);h.style.animationDelay=`${i*25}ms`;document.body.append(h);setTimeout(()=>h.remove(),1100);}}
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{const target=invoker;queueMicrotask(()=>{if(!dialog.open)(target?.isConnected?target:main.querySelector('h1'))?.focus({preventScroll:true});});});
  document.addEventListener('keydown',e=>{
    if(isBerry&&pocketButton===e.target&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();openPocket(e.key==='ArrowUp');return;}
    if(isBerry&&pocketMenu&&!pocketMenu.hidden){
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePocket();return;}
      if(e.key==='Tab'){closePocket();return;}
      const items=[...pocketMenu.querySelectorAll('[role="menuitem"]')],at=items.indexOf(document.activeElement);
      if(at>=0&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?items.length-1:(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();return;}
    }
    if(e.key==='Escape'&&document.body.classList.contains('nav-open')){document.body.classList.remove('nav-open');const menu=document.querySelector('[data-mobile-menu]');menu?.setAttribute('aria-expanded','false');menu?.focus();}
  });
  document.addEventListener('focusin',e=>{if(isBerry&&pocketMenu&&!pocketMenu.hidden&&!pocket.contains(e.target))closePocket(false);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.vault){state.vault=false;if(state.view==='vault')render();}});
  window.addEventListener('hashchange',route);
  window.addEventListener('pagehide',()=>{state.vault=false;});
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)document.body.classList.add('motion-paused');
  updateMotionToggle();
  setupPocket();
  route();
  notify('Интерактивное демо · изменения только в памяти вкладки');
})();

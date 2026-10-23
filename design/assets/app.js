/* Local, deliberately non-persistent design demo. No authentication or network API. */
(() => {
  const root = document.querySelector('[data-app]');
  if (!root) return;
  const motionToggle=document.createElement('button');motionToggle.type='button';motionToggle.className='motion-toggle';motionToggle.textContent='Остановить анимацию';motionToggle.setAttribute('aria-pressed','false');
  motionToggle.addEventListener('click',()=>{const paused=document.body.classList.toggle('motion-paused');motionToggle.textContent=paused?'Включить анимацию':'Остановить анимацию';motionToggle.setAttribute('aria-pressed',String(paused));});document.querySelector('.prototype-strip').append(motionToggle);
  const icon = (name) => {
    const paths = {
      heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
      cloud: '<path d="M7 18h11a4 4 0 0 0 .4-8 6.5 6.5 0 0 0-12.6-1A4.6 4.6 0 0 0 7 18Z"/>',
      mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="m3 6 9 7 9-7"/>',
      lock: '<rect x="4" y="10" width="16" height="12" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3"/>',
      folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
      arrow: '<path d="m9 5 7 7-7 7"/>',
      plus: '<path d="M12 4v16M4 12h16"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.heart}</svg>`;
  };
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
  const title = {cloud: 'Всё, что мы бережём', messages: 'Слова, которые греют', private: 'Только для нас двоих'};
  const cloud = document.querySelector('[data-panel="cloud"]');
  cloud.innerHTML = `<div class="section-heading"><div><span class="section-kicker">Наше облако</span><h1>${title.cloud}</h1><p>Одна история. Все фотографии, видео и маленькие сокровища.</p></div><span class="heading-doodle" aria-hidden="true">☁</span></div>
    <div class="cloud-toolbar"><div class="breadcrumbs" aria-label="Путь папки"><button type="button" data-root-folder>Облако</button><span data-crumb></span></div><label class="search">${icon('search')}<input type="search" aria-label="Поиск в открытой папке" placeholder="Найти что-то наше…" data-file-search></label></div>
    <div class="folder-grid" data-folders></div><div class="file-heading"><h2 data-folder-title>Любимое рядом</h2><span data-file-count></span></div><div class="file-grid" data-files></div><p class="quiet-note">Воспоминания и облако используют одни и те же фотографии ♡</p>`;
  const messages = document.querySelector('[data-panel="messages"]');
  messages.innerHTML = `<div class="section-heading"><div><span class="section-kicker">Наша почта</span><h1>${title.messages}</h1><p>Иногда самое важное помещается в одну строчку.</p></div><span class="heading-doodle" aria-hidden="true">♡</span></div>
    <div class="mail-layout"><div class="message-thread" data-thread aria-live="polite"><article class="message received"><span class="message-meta">Миша <time>09:14</time></span><p>Оставил тебе кофе на кухне. И маленькое «люблю» рядом с кружкой ♡</p></article><article class="message sent"><span class="message-meta">Аня <time>09:18</time></span><p>Нашла оба. День уже хороший!</p></article><article class="message received"><span class="message-meta">Миша <time>12:42</time></span><p>Вечером пойдём за теми самыми булочками? Я знаю длинную дорогу домой.</p></article></div>
    <form class="compose" data-message-form><div class="compose-stamp" aria-hidden="true">♡</div><h2>Маленькое послание</h2><p>Для Миши, от тебя.</p><label for="message">Что у тебя на сердце?</label><textarea id="message" name="message" maxlength="500" required placeholder="Я тут подумала…"></textarea><button class="primary-button" type="submit">Отправить сердечко ${icon('mail')}</button><small>Демо: сообщение появится только на этой странице и исчезнет после перезагрузки.</small></form></div>`;
  const privatePanel = document.querySelector('[data-panel="private"]');
  privatePanel.innerHTML = `<div class="section-heading"><div><span class="section-kicker">Наш тихий уголок</span><h1>${title.private}</h1><p>Личному — своё особенное место.</p></div></div><div class="private-demo"><div class="private-art" aria-hidden="true">${icon('lock')}<span>♡</span></div><div class="private-content"><span class="demo-badge">Демонстрация входа</span><h2>Ещё один маленький ключ</h2><p>В будущем здесь будет код из Google Authenticator или другого TOTP-приложения.</p><form data-private-form><label for="totp">6 цифр из приложения</label><input id="totp" class="code-input" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="000000" aria-describedby="demo-warning"><p id="demo-warning" class="demo-warning">Это макет. Любые цифры открывают демо; настоящей проверки и защиты здесь нет.</p><button type="submit" class="primary-button">Открыть демо-раздел ${icon('lock')}</button></form></div></div><div class="private-open" hidden><span class="demo-badge">Демо-раздел открыт</span><h2>Место для самого личного ♡</h2><p>Здесь показаны только безопасные пустые папки. Реальные материалы в прототип не загружаются.</p><div class="folder-grid"><div class="folder-tile">${icon('folder')}<strong>Наше личное</strong><small>Демонстрационная папка</small></div><div class="folder-tile">${icon('folder')}<strong>Письма друг другу</strong><small>Демонстрационная папка</small></div></div><button type="button" class="text-button" data-close-private>Закрыть демо-раздел</button></div>`;
  const names = {feed: 'Наша история', cloud: 'Наше облако', messages: 'Послания', private: 'Только наше'};
  function showView(name, focus = true) {
    document.querySelectorAll('[data-panel]').forEach(el => { el.hidden = el.dataset.panel !== name; });
    document.querySelectorAll('[data-feed-decoration]').forEach(el => {el.hidden=name!=='feed';});
    document.querySelectorAll('[data-view]').forEach(el => { const active = el.dataset.view === name; el.classList.toggle('is-active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
    document.title = `${names[name]} — LoveCloud`;
    if (focus) { window.scrollTo({top: 0, behavior: 'instant'}); const heading = document.querySelector(`[data-panel="${name}"] h1`) || document.querySelector('main h1'); if(heading){heading.tabIndex = -1; heading.focus({preventScroll:true});} }
  }
  document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => showView(el.dataset.view)));
  document.querySelectorAll('[data-carousel]').forEach(carousel => {
    const slides = [...carousel.querySelectorAll('[data-slide]')]; let at = 0;
    const count = carousel.querySelector('[data-counter]');
    const dots = carousel.querySelector('[data-dots]');
    dots.innerHTML = slides.map((_, i) => `<button type="button" aria-label="Фото ${i+1} из ${slides.length}" data-slide-to="${i}"></button>`).join('');
    function update() { slides.forEach((s,i) => s.hidden = i !== at); count.textContent = `${at+1} / ${slides.length}`; dots.querySelectorAll('button').forEach((b,i) => {b.classList.toggle('is-active', i === at); b.setAttribute('aria-pressed', String(i === at));}); }
    carousel.querySelector('[data-prev]').addEventListener('click', () => {at = (at+slides.length-1)%slides.length; update();});
    carousel.querySelector('[data-next]').addEventListener('click', () => {at = (at+1)%slides.length; update();});
    dots.addEventListener('click', e => {const b=e.target.closest('[data-slide-to]'); if(b){at=Number(b.dataset.slideTo);update();}}); update();
  });
  const photos = [
    ['Море в сентябре.jpg', '../strawberry/illustrations/cottage.svg', 'Море и скалистый берег'],
    ['Утро у моря.jpg', '../strawberry/illustrations/cottage.svg', 'Песчаный пляж у бирюзового моря'],
    ['Букет без повода.jpg', '../strawberry/illustrations/cottage.svg', 'Нежные цветы в солнечном свете']
  ];
  const folderNames = ['Поездки', 'Наши будни', 'Маленькие праздники']; let currentFolder = '';
  const search = document.querySelector('[data-file-search]');
  const dialog = document.createElement('dialog'); dialog.className='photo-dialog'; dialog.innerHTML='<button class="dialog-close" type="button" aria-label="Закрыть предпросмотр">×</button><img alt=""><p></p>'; document.body.append(dialog);
  const openPhoto = p => {dialog.querySelector('img').src=p[1];dialog.querySelector('img').alt=p[2];dialog.querySelector('p').textContent=p[0];dialog.showModal();};
  dialog.querySelector('button').addEventListener('click',()=>dialog.close()); dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  function renderFiles() {
    const nested = currentFolder === 'Поездки' ? ['Сентябрь у моря'] : currentFolder ? [] : folderNames;
    document.querySelector('[data-folders]').innerHTML=nested.map((n,i)=>`<button type="button" class="folder-tile" data-folder="${n}">${icon('folder')}<strong>${n}</strong><small>${currentFolder ? '3 фотографии' : [ '2 альбома', '18 воспоминаний', '7 воспоминаний'][i]}</small><span aria-hidden="true">♡</span></button>`).join('');
    const crumb=document.querySelector('[data-crumb]');crumb.replaceChildren();
    if(currentFolder==='Сентябрь у моря'){crumb.append(' / ');const parent=document.createElement('button');parent.type='button';parent.textContent='Поездки';parent.addEventListener('click',()=>{currentFolder='Поездки';search.value='';renderFiles();});crumb.append(parent,' / Сентябрь у моря');}
    else if(currentFolder)crumb.textContent=` / ${currentFolder}`;
    const list=(currentFolder === 'Наши будни' ? photos.slice(2) : photos).filter(p=>p[0].toLocaleLowerCase('ru').includes(search.value.toLocaleLowerCase('ru')));
    document.querySelector('[data-folder-title]').textContent=currentFolder || 'Любимое рядом';
    document.querySelector('[data-file-count]').textContent=`${list.length} фото`;
    const target=document.querySelector('[data-files]');target.innerHTML=list.length ? list.map(p=>`<button class="file-tile" type="button" data-photo="${photos.indexOf(p)}"><img src="${p[1]}" alt="${p[2]}" loading="lazy"><strong>${p[0]}</strong><small>Фото · из нашей истории</small></button>`).join('') : '<p class="empty-state">Пока ничего не нашлось. Попробуй слово «море» или очисти поиск.</p>';
    document.querySelectorAll('[data-folder]').forEach(b=>b.addEventListener('click',()=>{currentFolder=b.dataset.folder;search.value='';renderFiles();}));
    document.querySelectorAll('[data-photo]').forEach(b=>b.addEventListener('click',()=>openPhoto(photos[Number(b.dataset.photo)])));
  }
  document.querySelector('[data-root-folder]').addEventListener('click',()=>{currentFolder='';search.value='';renderFiles();});search.addEventListener('input',renderFiles);renderFiles();
  document.querySelector('[data-message-form]').addEventListener('submit',e=>{e.preventDefault();const textarea=e.target.querySelector('textarea');const value=textarea.value.trim();if(!value){textarea.focus();return;}const article=document.createElement('article');article.className='message sent';const meta=document.createElement('span');meta.className='message-meta';meta.textContent='Аня · сейчас · демо';const body=document.createElement('p');body.textContent=value;article.append(meta,body);document.querySelector('[data-thread]').append(article);textarea.value='';toast('Демо-послание добавлено ♡');});
  const codeInput=document.querySelector('#totp');codeInput.pattern='[0-9]{6}';codeInput.required=true;codeInput.setAttribute('aria-describedby','demo-warning code-error');
  const codeError=document.createElement('p');codeError.id='code-error';codeError.className='code-error';codeError.setAttribute('role','alert');codeError.hidden=true;codeInput.after(codeError);
  codeInput.addEventListener('input',()=>{codeInput.setCustomValidity('');codeError.hidden=true;codeInput.removeAttribute('aria-invalid');});
  codeInput.addEventListener('invalid',()=>{codeError.textContent='Введи ровно 6 цифр, например 123456. Это только проверка формата в макете.';codeError.hidden=false;codeInput.setAttribute('aria-invalid','true');});
  document.querySelector('#demo-warning').textContent='Это макет. Любой шестизначный код открывает демо; настоящей проверки и защиты здесь нет.';
  document.querySelector('[data-private-form]').addEventListener('submit',e=>{e.preventDefault();if(!/^[0-9]{6}$/.test(codeInput.value)){codeInput.reportValidity();return;}document.querySelector('.private-demo').hidden=true;document.querySelector('.private-open').hidden=false;toast('Открыт макет приватного раздела');});
  document.querySelector('[data-close-private]').addEventListener('click',()=>{document.querySelector('.private-demo').hidden=false;document.querySelector('.private-open').hidden=true;document.querySelector('#totp').value='';document.querySelector('#totp').focus();});
  const notice=document.createElement('div');notice.className='toast';notice.setAttribute('role','status');document.body.append(notice);let timer;
  function toast(message){notice.textContent=message;notice.classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>notice.classList.remove('visible'),3500);}
  document.querySelectorAll('[data-love]').forEach(b=>b.addEventListener('click',()=>{const active=b.getAttribute('aria-pressed')==='true';b.setAttribute('aria-pressed',String(!active));b.classList.toggle('loved',!active);b.innerHTML=`${icon('heart')} ${active ? 'Обнять воспоминание' : 'Обнято тобой'}`;}));
  showView('feed',false);
})();

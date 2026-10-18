# LoveCloud API v1

Весь контент пуст при новой установке: demo seeds и публичной регистрации нет. JSON camelCase, ошибки `application/problem+json` с `status/title/detail`.

## Запуск и конфигурация

.NET 10; EF Core 10.0.13; Npgsql EF provider 10.0.3; PostgreSQL 18. Docker build context — `backend/`, API слушает 8080, `GET /health` проверяет БД. Миграции применяются на старте; bootstrap под advisory lock добавляет только отсутствующий singleton и admin. Существующий пароль не сбрасывается.

- `ConnectionStrings__DatabaseFile=/run/secrets/database_connection` — приоритетный файл строки подключения; fallback `ConnectionStrings__Database`.
- `Bootstrap__PasswordFile=/run/secrets/bootstrap_password` — нужен только при отсутствии admin. Username `admin`, пароль 12–256 символов; генерирует оператор, встроенного значения нет.
- `Storage__Root=/data/files`; `DataProtection__KeyPath=/data/keys` — постоянные тома с правом записи app UID1654.
- `App__Origin=http://localhost:3211`; `App__SecureCookies=false` допускается исключительно для loopback HTTP. Для HTTPS `true`.
- `Setup__TokenFile=/run/secrets/setup_token` — random256bit HEX setup-secret. БД хранит только SHA256, файл/ссылка обслуживаются скриптами установки. У legacy-развёртываний без этого параметра/файла сохраняется обычный admin bootstrap.

DataProtection шифрует TOTP secrets в БД; key ring лежит в каталоге с UNIX0700, plaintext key ring доступен владельцу процесса/тома. Нужно сохранять и защищать этот том вместе с backup; без него секреты не расшифровать. Это серверная защита, не E2EE. Сам том файлов и backups оператор шифрует средствами хоста. Не копировать secrets в env/образы. API не пишет их/пароли/QR/тела запросов в логи.

## Одноразовая установка и внешний вид

Формат мастера описан в [SETUP.md](SETUP.md); миграция `AddSetupAppearanceAvatars` только добавляет поля/таблицы/ограничения, без удаления старых данных. `PairSettings` получает `locale=ru`, `theme=berry`, nullable avatarId; users получают nullable avatarId. `auth/me`, `admin/users`, `pair/members` и posts расширены avatarUrl/authorAvatarUrl. Настройки пары в me включают locale/theme/avatarUrl.

| Endpoint | Поведение |
| --- | --- |
| `GET /setup/status` | Anonymous `{required,locale,theme}`; без имён пары, пользователей и avatar IDs. |
| `POST /setup/exchange {token}` | Exact Origin, persistent IP/global rate limit, атомарный single claim. `{csrfToken}` + `lovecloud_setup` HttpOnly/SameSiteStrict/Secure по конфигурации, Path `/`, TTL24h; в БД только hash cookie. Неверный secret401, чужой повтор409. |
| `GET /setup/session` | `{csrfToken,pendingAvatars:[{id,url}]}` только текущей setup-cookie; без неё/после expiry/complete401. После reload можно заново назначить/удалить свои pending, не расходуя лимит3 новыми загрузками. Поля/пароли draft сервер не сохраняет. |
| `POST /setup/avatar` | Multipart `file`, до2MiB; `{id,url}`. Не больше3 pending на claim. |
| `DELETE /setup/avatar/{id}` | Только собственный pending, освобождает pending-слот;204, чужой/уже удалённый404. |
| `POST /setup/complete` | Полный DTO контракта: locale/theme, pair, adminPassword, ровно2partners. Одна транзакция сохраняет3слота/пару/аватары/пароли, завершает setup и отзывает claims. Ответ как auth/me + ordinary cookie первого partner. |
| `PATCH /settings/appearance {locale?,theme?}` | Обычный admin/partner с CSRF; возвращает pair DTO; `WorkspaceChanged {area:"settings"}`. |
| `POST /profile/avatar`, `/pair/avatar` | Multipart `file`, обычный CSRF. Profile — только self; pair — любой admin/partner. Возвращают соответственно User DTO/pair DTO. |
| `DELETE /profile/avatar`, `/pair/avatar` | Убирают соответствующую ссылку,204; обычный CSRF. |
| `GET/HEAD /avatars/{id}/content` | No-store/nosniff PNG. Обычная valid session читает готовый используемый avatar; setup-cookie — только свой pending. Anonymous401; чужой pending404. |

Для `/setup/avatar`, DELETE avatar и complete используется **X-Setup-CSRF** + точный Origin, отдельно от ordinary X-CSRF-Token. Обычная cookie не заменяет setup-cookie. Exchange/session/complete не сохраняют пароль или secret в URL/логи/БД plaintext. Ссылка frontend использует fragment, затем удаляет fragment после exchange. EN Accept-Language даёт английские setup security errors; старые общие validation errors могут локализоваться фронтендом.

Resume: `/setup/session` возвращает только свои pending IDs/URLs, без данных чужой сессии. Если в том же браузере осталась ordinary bootstrap-admin cookie с mustChangePassword=true, setup-cookie всё равно разрешает чтение собственных pending-аватаров; остальные ordinary endpoints остаются закрыты до смены пароля. Это покрыто отдельной PostgreSQL/HTTP-проверкой с обеими cookies.

Под одним transaction advisory lock `setup` работают startup/backfill, exchange/complete, операторский reset и первая смена пароля legacy-admin. После завершения tokenHash и claim очищаются, setup-sessions удаляются; выбранный admin password постоянный, первый partner mustChangePassword=false, второй=true. Существующие auth-сессии bootstrap-admin отзываются. В завершённой установке изменение token-файла не открывает мастер заново и не меняет пароли/имя/контент.

При startup установки с партнёрами/контентом или уже изменённым admin password backfill отмечает completed и сохраняет данные. Если есть только untouched bootstrap-admin — мастер доступен. Смена legacy-admin password закрывает даже уже заявленную setup-сессию; при гонке complete/password change выигрывает один путь. Для незавершённой установки изменившийся hash token-файла отзывает старый claim, старые pending становятся orphan; истёкший24h claim сам не освобождает одноразовую ссылку — требуется операторский reset.

Аватары хранятся отдельно в `Storage__Root/avatars` по UUID и не входят в Files/list/albums/quota облака. MIME должен совпадать с PNG/JPEG/WebP signature; SkiaSharp4.153.1 декодирует реальные pixels после проверки4096px/16MP, одновременно максимум2decode, уменьшает до512px и создаёт PNG без исходных метаданных/приложенного содержимого. Размер запроса ограничивается **до чтения body** (2MiB+64KiB envelope), file — строго2MiB. Complete принимает только IDs pending текущей setup-сессии. После смены/удаления avatar старый URL сразу недоступен без действующих ссылок. Cleanup каждые10мин удаляет неиспользуемые/orphan файлы старше1часа, а active pending сохраняет до конца setup-сессии. Реальные файлы/посты cleanup аватаров не затрагивает.

## Auth и роли

`POST /api/v1/auth/login {username,password}` требует точный `Origin`; устанавливает `lovecloud_session` Secure-настройка/HttpOnly/SameSite=Strict, opaque random256bit, в БД только SHA256 hash. Сессия действует 7 суток, сервер проверяет disabled/expiry при каждом запросе. После login вызвать `GET /auth/csrf` и передавать `X-CSRF-Token` во всех POST/PUT/PATCH/DELETE, вместе с Origin. После change-password обновить CSRF: токен меняется. Login остаётся без CSRF, но с обязательным Origin.

Новый admin/partner обязан сначала выполнить `POST /auth/change-password {currentPassword,newPassword}`; пока флаг установлен, разрешены только me/csrf/change-password/logout. Новые пароли 12–256 символов. Остальные сессии и vault-сессии отзываются при смене пароля. Logout удаляет текущую сессию и закрывает её SignalR connections; блокировка admin отзывает сессии пользователя. Неизвестный логин и неверный пароль дают одинаковый ответ с PBKDF2 verification. Login ограничен по account/IP, пять неудачных account-попыток → блок15мин; счётчики в БД переживают restart.

Admin имеет только `/admin/**`, me/csrf/password/logout; partner — контент. В БД UNIQUE slot и CHECK1..3 + CHECK role/slot; нельзя создать четвёртого пользователя даже прямой конкурентной записью. `GET /pair/members` partner-only → `[{id,displayName}]` обоих partner-слотов (включая disabled, для показа существующих связей). Задаче нельзя назначить disabled/admin.

## Облако

Routes и DTO — как в implementation contract. `GET /files` без folderId даёт корень; `q` ищет глобально внутри выбранного space, view игнорирует folder. Папки не удаляются, пока есть вложенные папки или любые файлы (в том числе trash). Имена папок уникальны среди siblings без учёта регистра; cross-space parent/file связи запрещены composite FK, цикл папок — проверкой под lock.

Upload — streaming multipart, ровно `file`, optional `folderId`, `space`; поля могут идти после file. Лимит5GiB, оригинал на диске под UUID; имя никогда не используется как путь. MIME определяется по сигнатуре, недоверенный тип скачивается как octet-stream/attachment. Quota100GiB общая, vault≤20GiB, trash учитывается. Завершение и квота сериализованы в БД; при отказе temp/blob удаляется. Staging и orphan после crash очищаются через24часа. HEAD/Range проверяют доступ, `Results.File` поддерживает206/416/If-Range; все медиа `no-store/nosniff`. Доступ долгого stream перепроверяется не реже2сек; уже полученные байты отозвать невозможно.

`POST /folders/envelope` атомарно создаёт папку внутри optional parent и переносит в неё выбранные файлы из любых папок, сохраняя IDs и все ссылки; весь набор обязан принадлежать одному space. Favorites персональные. Recent запоминает полноценный GET content (не HEAD/Range), поэтому показ оригинала-превью тоже считается просмотром. Recent retention90дней. Отдельных thumbnails/transcoding пока нет: thumbnailUrl изображения ссылается на тот же защищённый оригинал; для других MIME может отсутствовать.

DELETE file — корзина30дней, content сразу404, квота сохраняется. Альбомы/посты скрывают trashed-вложения; restore до GC возвращает те же IDs и связи. Это прагматичнее раннего плана с ручным detach/409. После30дней GC снимает ссылки и удаляет blob/метаданные; restore и GC сериализованы storage lock. Удаление альбома никогда не удаляет original. `/storage` показывает shared-байты (включая trash) и живые shared fileCount, без vault-метаданных. `/activity` — последние200 разрешённых shared-событий за90дней; нет vault/подарочных резервов.

## Социальный поток

Единственные таблицы posts/post files обслуживают message/memory/reply, общие originals. Feed cursor подписан DataProtection и привязан к kind/верхней sequence/позиции; invalid400. `limit`1–100. `pinned` — metadata: хронология cursor остаётся стабильной, UI выделяет до3 pin-карточек без отдельного server pinned-блока. PATCH текста/DELETE — автор; PATCH pinned — любой партнёр. Root deletion оставляет tombstone для чужих ответов и снимает attachment refs. Reply только к живому root, один уровень; replies по возрастанию sequence.

`clientPostId` optional, до100символов: повтор возвращает прежний post/reply; другое содержимое409. Heart PUT/DELETE идемпотентен, count≤2. Нет delivered/read/conversations/typing. `WorkspaceChanged {area,id?}` через `/hubs/workspace` — invalidation, HTTP — durable state. Reconnect всегда refetch; это не гарантированная очередь событий для offline клиента. Outbox хранится в транзакции с изменением, worker отправляет at-least-once и удаляет после отправки. Клиент не выбирает группы. Disabled/expired connections закрываются максимум через2сек.

## Планнер и желания

Task DTO и routes строго из контракта; assigneeId null = вместе. Срок DateOnly YYYY-MM-DD. Complete repeating-задачи создаёт ровно одно следующее вхождение от прежней dueDate: +1/+7дней или AddMonths(1) с прижатием к последнему дню месяца. Пример31января →28/29февраля →28/29марта. Открыть/повторно завершить исходную задачу не создаёт дубль: persisted flag + UNIQUE previousOccurrenceId + lock. Это модель completion-driven, не будущие materialized серии из раннего плана. Все три UI-представления используют эти же записи.

Wish owner берётся только из сессии; правит/удаляет автор. Цена optional RUB decimal, неотрицательная, до двух знаков; ссылки только absolute HTTP(S), без userinfo, никакого сетевого fetch метаданных/цен/favicon. Текст plain, HTML не исполняется. Reservation лежит отдельно и не меняет публичный wish timestamp/порядок. `reservation` ключ полностью отсутствует для автора; доступен только бронирующему партнёру. PUT/DELETE своего желания reservation404. Удаление желания не выдаёт, что оно было reserved. Reserve-события идут только user-группе бронирующего; общих activity/outbox notifications нет.

## Vault

Общий vault пары, индивидуальные TOTP secrets и cookies/sessions. `enrollment {password}` возвращает новый160bit secret и otpauth URI для локального QR; pending10мин, связан с обычной сессией. При активном факторе повторная привязка требует recovery. Confirm проверяет RFC6238 HMAC-SHA1/6цифр/30сек/±1шаг, активирует фактор и погашает подтверждённый шаг; выдаёт10 recovery codes по128бит один раз. **Для unlock после confirm нужен следующий временной код.** Secret защищён DataProtection, recovery codes в БД — SHA256 хеши.

Unlock atomic под account lock: accepted step должен быть строго больше last accepted. TTL vault10мин absolute, токен256bit/hashDB, связь с user + auth session + credential version. Cookie Path `/` необходим из-за общих `/files/**` routes; API всё равно проверяет vault для каждого space/file, включая HEAD/Range/thumbnail. Ни shared hub, ни activity не содержат vault данных.

Recovery требует пароль + одноразовый recovery code, отзывает vault-сессии и разрешает enrollment только текущей обычной сессии на10мин; **не открывает файлы**. Новый confirm заменяет фактор и все старые recovery codes. Lock закрывает vault только текущей обычной сессии. Пять неудачных TOTP/recovery/account-попыток →15мин блок, отдельно IP-limit. Потеря DP keys даёт503 и не вызывает автоматическую замену фактора. Админ не имеет endpoint обхода.

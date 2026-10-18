# Свой адрес в tailnet ☁️

Этот вариант предназначен для **Linux-сервера с Docker**.
LoveCloud получает отдельное имя Tailscale. Основной узел сервера и его
другие приложения сохраняют свои адреса. Funnel не используется.

## 1. Подготовить секреты

```sh
cp .env.example .env
sh scripts/init.sh --quiet-secrets
```

Пока не используйте `--start`: ниже запускается отдельный состав контейнеров.

## 2. Добавить узел

```sh
docker compose -f compose.yaml -f compose.tailnet.yaml up -d tailscale
docker compose -f compose.yaml -f compose.tailnet.yaml exec tailscale \
  tailscale up --hostname=lovecloud --accept-dns=false --timeout=0
```

Откройте показанную ссылку и подтвердите узел в нужном tailnet.
Процесс ждёт авторизации без короткого таймаута. Узлу нужен доступ к
управляющему серверу Tailscale; в compose включён `TS_FORCE_NOISE_443`.

## 3. Настроить HTTPS

```sh
docker compose -f compose.yaml -f compose.tailnet.yaml exec -T tailscale \
  tailscale serve --bg --yes --https=443 http://127.0.0.1:3211
docker compose -f compose.yaml -f compose.tailnet.yaml exec -T tailscale \
  tailscale serve --bg --yes --http=80 http://127.0.0.1:3212
```

Команда покажет реальный адрес вида `https://lovecloud.your-tailnet.ts.net`.
Если имя уже занято, используйте имя, назначенное Tailscale.

Добавьте в `.env`, подставив этот адрес:

```dotenv
COMPOSE_FILE=compose.yaml:compose.tailnet.yaml
APP_ORIGIN=https://lovecloud.your-tailnet.ts.net
SECURE_COOKIES=true
```

В `ops/nginx.tailnet.conf` замените пример
`https://lovecloud.example-tailnet.ts.net` на тот же реальный адрес.
Это canonical URL для перенаправления короткого HTTP-имени на HTTPS.

## 4. Открыть свой дом

```sh
sh scripts/init.sh --quiet-secrets
docker compose up -d --build
```

Повторный init без `--start` обновит `.secrets/setup-link.txt` с вашим HTTPS-доменом,
сохранив секрет. Откройте эту ссылку для новой установки. У уже настроенной пары
мастер не открывается повторно — используйте обычный вход.

Короткое имя `http://lovecloud` перенаправит на HTTPS, если оно назначено узлу.
В браузере должен работать клиент Tailscale с доступом к этому tailnet.

## Обновлять и сохранять

Благодаря `COMPOSE_FILE` в `.env` обычный `docker compose up -d --build`
использует оба файла. При явном `-f` всегда указывайте и base, и tailnet compose.
Для этого варианта init используется без `--start`; стек запускается командой выше.

Узел работает в userspace-режиме с host network и случайным UDP-портом.
TUN и NET_ADMIN ему не нужны. Вход nginx опубликован только на loopback3211/3212;
в tailnet его проксирует Serve. HTTPS-сертификат выпускает Tailscale.

Состояние и Serve-конфигурация сохраняются в `lovecloud_tailnet_state`.
Сохраняйте этот том вместе с [данными приложения](SELF_HOSTING.md#backups).

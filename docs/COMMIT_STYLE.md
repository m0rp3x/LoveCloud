# Письма в историю LoveCloud 💌

История проекта — наш общий дневник работы. Пусть каждое сообщение объясняет,
что изменилось, и оставляет немного тепла следующему человеку.

## Как подписать письмо

```text
type(scope): emoji short description in English
```

Тип стоит первым: такой формат совместим с Conventional Commits.
Эмодзи живёт после двоеточия. Все сообщения коммитов пишем только на английском:
заголовок, тело, пояснения к отмене и BREAKING CHANGE.

```text
feat(wishes): 🎁 add secret gift reservations
```

## Поводы написать

| Тип | Настроение | Когда использовать |
| --- | --- | --- |
| `feat` | 💌 Подарить новую возможность | Новая функция или поведение для пары. |
| `fix` | 🩹 Позаботиться | Исправление конкретной ошибки. |
| `style` | 🎀 Навести красоту | Оформление, типографика, отступы и анимации без изменения поведения. |
| `refactor` | 🧵 Переплести аккуратнее | Изменение устройства кода с прежним поведением. |
| `perf` | 💓 Дать сердцу лёгкость | Измеримое ускорение или уменьшение расхода ресурсов. |
| `test` | 🧸 Подстраховать | Проверки сценариев, регрессий и важных границ. |
| `docs` | 💐 Оставить записку | README, инструкции и документация. |
| `build` | 📦 Собрать посылку | Зависимости, сборка и Docker-образы. |
| `ci` | 🕊️ Помочь посылке долететь | Автоматические проверки и доставка. |
| `chore` | 🧺 Прибраться дома | Обслуживание репозитория и инструментов. |
| `revert` | 💫 Вернуться на шаг | Отмена предыдущего изменения с пояснением причины. |

Для подарков удобно использовать 🎁, для планнера — 🗓️, для языка — 🌍.
Эмодзи выбираем по смыслу; тип по-прежнему описывает характер изменения.

## О чём письмо

Подходящие области: `cloud`, `feed`, `planner`, `wishes`, `vault`, `setup`,
`auth`, `themes`, `i18n`, `api`, `db`, `docker`, `readme`.
Область можно опустить, если изменение касается проекта целиком.

Пишем конкретно: действие и результат. Заголовок стараемся уложить в 72 символа.
Точка в конце не нужна.

```text
feat(planner): 🗓️ add weekly recurring dates
fix(auth): 🩹 preserve sessions when changing themes
style(themes): 🎀 soften Cloud Atelier cards
refactor(api): 🧵 extract file access checks
perf(cloud): 💓 reduce repeated folder requests
test(setup): 🧸 reject reused setup links
build(docker): 📦 preserve keys across container recreations
```

Один коммит посвящаем одному понятному изменению. В тело при необходимости
добавляем причину, важный компромисс и способ проверки:

```text
fix(vault): 🩹 close previews when the session expires

An open preview remained visible after the access timer expired.
Close it together with the private vault session.

Validation: open a file, expire the session, then retry GET and Range.
```

Для несовместимого изменения используем `!` и описываем переход:

```text
feat(api)!: 💌 update the task recurrence format

BREAKING CHANGE: repeat now accepts none, daily, weekly and monthly.
Update the client together with the server.
```

## Маленький шаблон для редактора

В репозитории есть [.gitmessage](../.gitmessage). Подключить его только для LoveCloud:

```sh
git config --local commit.template .gitmessage
```

Затем обычный `git commit` откроет подсказки в вашем редакторе.
Настройка не меняет Git-профиль автора.

Коммиты подписываем своим именем и адресом из Git-профиля. Автоматические
подписи инструментов и дополнительные строки о соавторах не добавляем.

♡ Немного тепла в сообщении, достаточно смысла для будущего читателя.

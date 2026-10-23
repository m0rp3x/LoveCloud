# Launch materials / Материалы анонса

Drafts only. Community publication requires a separate instruction.
Use these after v0.1.0 passes acceptance and its release links are live.

## Short descriptions

**EN:** LoveCloud is a self-hosted space for one couple: shared files, memories,
love notes, plans and wishlists, with a gentle illustrated interface.

**RU:** LoveCloud — self-hosted пространство для одной пары: общие файлы,
воспоминания, послания, планы и вишлисты в нежном рисованном интерфейсе.

Team: **neo_mei**. Repository: https://github.com/m0rp3x/LoveCloud.

## General English announcement draft

**LoveCloud v0.1.0: a small self-hosted home for two hearts**

LoveCloud brings a couple's files, memories, little notes, shared plans and
wishlists together in an illustrated workspace. It runs on your own server
with Next.js, ASP.NET Core and PostgreSQL, packaged with Docker Compose.

Try the **interactive preview** without registration:
https://m0rp3x.github.io/LoveCloud/ . This is a static prototype with fictional
data. Changes stay in the tab; uploads and verification codes are simulated.

For the **full application**, install the versioned Docker release:
https://github.com/m0rp3x/LoveCloud/releases/tag/v0.1.0 . The installer creates
a private first-run link for language, two partner accounts, avatars and theme.

This is an early release for Linux amd64 and a single couple. The private vault
uses TOTP, but storage is server-side, without end-to-end encryption. There are
no real thumbnails, resumable uploads, S3 storage or video transcoding yet.
Please read the access model and backup instructions before using personal data.

Feedback on installation, clarity and accessibility is welcome. Made by neo_mei.

## Общий черновик на русском

**LoveCloud v0.1.0 — маленький self-hosted дом для двоих**

Мы собрали файлы, воспоминания, послания, общие дела и желания пары в одном
рисованном пространстве. LoveCloud работает на вашем сервере: Next.js,
ASP.NET Core, PostgreSQL и Docker Compose.

**Интерактивный предпросмотр** можно открыть без регистрации:
https://m0rp3x.github.io/LoveCloud/ . Это статический прототип с вымышленными
данными. Изменения остаются в текущей вкладке; загрузка и коды имитируются.

**Полное приложение** устанавливается из готовых образов релиза:
https://github.com/m0rp3x/LoveCloud/releases/tag/v0.1.0 . Установщик выдаёт личную
одноразовую ссылку для выбора языка, создания двух аккаунтов, аватарок и темы.

Это ранняя версия для Linux amd64 и одной пары. В личном разделе есть TOTP,
но хранение серверное, без E2EE. Настоящие миниатюры, возобновляемые загрузки,
S3 и транскодирование видео остаются будущими задачами. Перед личными данными
прочитайте модель доступа и инструкцию резервного копирования.

Будем рады конкретным замечаниям по установке и удобству. С любовью, neo_mei.

## Community placement research

Rules checked on **2026-10-23**. Recheck the linked rules before any later post.
No external announcement has been posted as part of LC-000.

| Place | Suitable use and current conditions |
| --- | --- |
| [r/selfhosted rules](https://www.reddit.com/r/selfhosted/about/rules.json) | A relevant audience for Docker installation and ownership of data. Projects younger than three months belong **only in the current New Project Megathread**. This repository became public on2026-10-18, so use the current pinned thread rather than a standalone launch post. Include English, useful detail and docs; avoid repeated promotion. Check the [community highlights](https://www.reddit.com/r/selfhosted/) for the current thread instead of keeping an obsolete thread URL here. |
| [Show HN](https://news.ycombinator.com/showhn.html) | A working interactive preview without signup suits the try-it requirement; the author should be available to discuss substantial personal work. No landing-page-only submission, vote solicitation or repeated reposting. The [HN guidelines](https://news.ycombinator.com/newsguidelines.html) require personally written posts and disallow generated or AI-edited text. The owner must write their own submission; the general draft above is **not** a HN submission. |
| [Lobsters](https://lobste.rs/about) | Consider a substantive technical account of deployment, isolation or recovery rather than a general productivity/product announcement. The community uses invitations; self-promotion is disallowed for new users during their first70days and should remain a small share of established users' activity. Account eligibility is not assumed. |
| [awesome-selfhosted contributing rules](https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md) | A later directory submission, **not a launch channel for v0.1.0**. The first release must be more than four months old. Use its software YAML template and concise factual description when eligible. Machine-generated contributions are disallowed; the owner must prepare their own eventual submission. No PR has been sent there. |

## Small contribution candidates

These are issue drafts, not promises of work or already published issues.
LC-001 remains the separate thumbnails/gallery-speed task in ROADMAP.

| Bounded task | Scope | Acceptance |
| --- | --- | --- |
| Explain common media fallback states | Add a short format/fallback table to `docs/LIMITATIONS.md` with links to actual UI behavior. | Distinguish browser codec support, original-file preview and download fallback; no unsupported codec promises. |
| Add a keyboard-focused preview tour | Extend the preview documentation with the exact Tab/Enter/Escape route through navigation and a modal. | Verify the route on desktop and mobile-sized viewport; report focus return and reduced-motion without personal data. |
| Improve one installation diagnostic | Pick one already detected failure (for example, missing existing secrets) and add a targeted fixture for its recovery hint. | No secret values in output; fixture checks refusal and the concrete next step, without touching live data. |

## Media

Use the fictional-pair screenshots in `docs/assets/`. The preview walkthrough
must keep its simulation notice visible and must not show real photos, logins,
TOTP enrollment secrets, recovery codes or private deployment addresses.

<p align="center"><img src="docs/assets/banner.svg" alt="LoveCloud — a little home for two" width="100%"></p>
<p align="center"><strong>Your memories, little plans and big feelings, in your own cloud.</strong><br>A self-hosted home for loving hearts, from the <strong>neo_mei</strong> team.</p>
<p align="center"><a href="README.ru.md">Русский</a> · <a href="https://m0rp3x.github.io/LoveCloud/">Interactive preview</a> · <a href="https://github.com/m0rp3x/LoveCloud/releases/tag/v0.1.0">Install v0.1.0</a> · <a href="docs/SELF_HOSTING.md">Hosting guide</a></p>

![LoveCloud: hand-drawn envelopes in a fictional couple’s cloud](docs/assets/cloud.jpg)

**v0.1.0 is an early release for one couple and one server.** Linux amd64 is the release target. There is no end-to-end encryption, resumable upload or generated thumbnail service. Read the [access model and limits](docs/LIMITATIONS.md) before adding personal memories.

## A little place for a big “us” ♡

LoveCloud brings files, a social feed, shared plans and wishlists into a private space you run yourself. Drawn paper envelopes and floating hearts make a familiar cloud feel like your own desk. Choose Strawberry Milk, Rose Drive or Cloud Atelier; the full application speaks English and Russian.

**[Try the interactive preview](https://m0rp3x.github.io/LoveCloud/)** without registration. It is a static prototype with fictional data and per-tab changes. File upload and code verification are simulated; it has no backend or two-user synchronization. It is separate from the real application you install.

| Keep together | What the installed app does |
| --- | --- |
| 📷 Memories | Real files, nested folders, albums, search, favorites, recent items, desk/grid/list views. |
| ✉️ Little treasures | Envelopes organize files; albums reference originals. Trash can be restored before its 30-day expiry. |
| 💌 Words | A social feed with posts, attachments, replies, hearts, pins and SignalR updates. |
| 🗓️ Plans | Shared tasks, list/week/kanban views, assignees, deadlines, priorities and recurrence. |
| 🎁 Wishes | Each partner’s wishlist, notes, links and prices; gift reservations are hidden from the wish’s author. |
| 🔐 Private moments | A shared protected area with each partner’s TOTP, recovery codes and temporary access. |

<table><tr><td><img src="docs/assets/feed.jpg" alt="Social feed"></td><td><img src="docs/assets/planner.jpg" alt="Shared planner"></td></tr><tr><td><img src="docs/assets/wishes.jpg" alt="Wishlists"></td><td><img src="docs/assets/cloud-atelier.jpg" alt="Cloud Atelier theme"></td></tr></table>

Screenshots show a separate synthetic installation, never a real couple’s data. [Media provenance](docs/assets/README.md).

## Move into your cloud 🏡

Download **lovecloud-v0.1.0-install.tar.gz** or **.zip** from the [release](https://github.com/m0rp3x/LoveCloud/releases/tag/v0.1.0), verify its checksum, extract it and open a terminal there. Normal installation downloads ready-made, digest-pinned images. No Git, Node.js or .NET SDK is needed.

Requirements: Docker Engine (or Docker Desktop in Linux-container mode), Compose v2.24.4 or newer, a supported shell and internet access to GHCR / Docker registries. The shell installer needs `openssl`; PowerShell requires version 7. Supported release images are **linux/amd64**; macOS/arm64 native support has not been verified.

```sh
sh scripts/init.sh --start
```

```powershell
./scripts/init.ps1 -Start
```

The installer waits for readiness and prints a one-time setup link, also stored in `.secrets/setup-link.txt`. Keep it private. Choose RU/EN, name your pair, add avatars, create both partner accounts, choose a theme and set the administrator password. The first partner signs in immediately; the second changes their initial password at first login. There are exactly **three accounts: administrator and two partners**. After completion the setup link cannot reopen setup. A new installation contains no demo content.

By default the app binds to loopback at `http://localhost:3211`. For two-person remote use, configure [HTTPS](docs/SELF_HOSTING.md#https) or [Tailscale](docs/TAILSCALE.md). Plain HTTP is for local access; do not expose it directly on the internet.

## Keep your memories safe

The server operator can access stored data and keys. TOTP is an additional application access check, **not E2EE**. Keep an encrypted, off-host backup of PostgreSQL, file/avatars storage, DataProtection keys, secrets and the effective installation configuration. Store the backup password separately.

[Install and configure](docs/SELF_HOSTING.md) · [First setup](docs/SETUP.md) · [Update](docs/UPDATE.md) · [Backup and restore](docs/BACKUP_RESTORE.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

## Woven from 🧵

Next.js / React / TypeScript → nginx → ASP.NET Core 10 / SignalR → PostgreSQL 18 and persistent file/key volumes. A single API process handles live updates and cleanup. [Architecture and data locations](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Develop from source](docs/DEVELOPMENT.md).

## Add a little love 💌

[Contributing](CONTRIBUTING.md) · [Romantic English commit style](docs/COMMIT_STYLE.md) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) · [Report a vulnerability privately](SECURITY.md)

```text
feat(feed): 💌 add replies to love notes
fix(vault): 🩹 close access when the session expires
docs(readme): 💐 welcome loving hearts
```

## License

LoveCloud’s original code is licensed under [Apache-2.0](LICENSE). Fonts, dependencies and container components retain their own licenses; see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES), [the licensing audit](docs/LICENSING_AUDIT.md), and the exact-image SBOM / license bundle attached to each release. Apache-2.0 permits commercial use under its terms; no payment, contribution-back or PR requirement is added.

<p align="center"><strong>With love, the neo_mei team ♡</strong><br><sub>So every “us” has a little home.</sub></p>

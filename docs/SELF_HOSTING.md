# Install a little home for two / Установка

Use the [v0.1.0 installation archive](https://github.com/m0rp3x/LoveCloud/releases/tag/v0.1.0), not a source archive. It contains production Compose, proxy configurations, operational scripts, image digest lock and licenses. No `backend/` or `frontend/` is needed to run it.

## Requirements

- Linux amd64 Docker host; Docker Engine or Docker Desktop in Linux-container mode.
- Docker Compose v2 with `up --wait`; internet access to the image registries.
- POSIX shell and `openssl` for `init.sh`, or PowerShell 7 for `init.ps1`.
- Sufficient disk for originals, PostgreSQL, staging during upload and backups.
- Backup/restore scripts additionally require Python 3 (standard library); no Node.js, Git or .NET SDK is needed for normal installation.

Other architectures are not declared supported without an actual release test. There is no universal promised CPU/RAM capacity or install time.

## Verify and extract

Download the archive and `SHA256SUMS` from the same release. Verify before running scripts:

```sh
sha256sum -c SHA256SUMS --ignore-missing
tar -xzf lovecloud-v0.1.0-install.tar.gz
```

```powershell
Get-FileHash ./lovecloud-v0.1.0-install.zip -Algorithm SHA256
Expand-Archive ./lovecloud-v0.1.0-install.zip -DestinationPath ./lovecloud
```

Compare the PowerShell hash with its exact entry in `SHA256SUMS`. Enter the extracted installation directory (the directory containing `compose.yaml`).

## First start

```sh
sh scripts/init.sh --start
```

```powershell
./scripts/init.ps1 -Start
```

The installer creates private secrets on a fresh installation, downloads ready-made images, runs Compose with `--no-build`, waits for health and prints a one-time setup link. The link is also saved in `.secrets/setup-link.txt`. Do not share it, `.secrets/`, cookies or recovery codes in an issue.

[Complete setup](SETUP.md). Re-running the installer preserves secrets and data. If an existing installation is missing its database secret, **restore that secret from a backup**; a newly generated password would not change the existing database password. The installer stops rather than hiding this condition.

The default endpoint is `http://localhost:3211`, bound to `127.0.0.1`. PostgreSQL is not published. Non-root API/frontend processes must be able to read their mounted secrets; use installer-created permissions, not blanket `chmod 777`.

## Effective configuration

The installation's `.env` records its effective settings: Compose project, Compose file list, address, cookie security and supported overrides. Preserve it during restart, backup, update and recovery. Release archives include `compose.images.yaml`, which pins the tested image digests. Normal production Compose has no `build:` sections.

Keep the original project name. Existing volumes can use a custom Compose prefix or explicit volume names. **Do not rename the project to `lovecloud-v0.1.0`**. If invoking Compose with explicit `-p`, `-f` or external variables, use the same values for every operation and record them in the installation configuration.

```sh
docker compose config --images
docker compose ps
docker compose logs --tail=80 api frontend gateway
```

`docker compose config` without `--images` may contain sensitive paths/settings: review and redact before sharing. A restart does not require rebuilding:

```sh
docker compose up -d --no-build --wait
```

Do not run `docker compose down -v` on a real installation: it deletes volumes.

<a id="https"></a>

## HTTPS on your own domain

Point your domain at the host. Caddy needs inbound 80/443, outbound certificate access, and a persistent certificate volume. Add to `.env`, using your real domain:

```dotenv
LOVE_CLOUD_DOMAIN=cloud.example.com
APP_ORIGIN=https://cloud.example.com
SECURE_COOKIES=true
```

Run the installer with `--start` / `-Start`; it persists the HTTPS override along with the digest lock. Check that the resulting Compose list contains base, image lock and `compose.https.yaml`, then open the HTTPS setup link. Preserve Caddy's volumes and configuration during updates.

For a reverse proxy you manage yourself, proxy **all** `/api/v1`, `/hubs` (including WebSocket upgrade) and frontend paths through the gateway, set the exact external `APP_ORIGIN` and `SECURE_COOKIES=true`, and keep direct API/database ports private. Avoid caching authenticated responses. An origin mismatch is a configuration error, not a reason to disable CSRF.

## Private remote access

[Tailscale](TAILSCALE.md) is an optional Linux-only topology with a dedicated node and HTTPS Serve. It is not enabled by the normal local installer. No VPS is needed for the static [interactive preview](https://m0rp3x.github.io/LoveCloud/).

The preview is **not** your installed cloud. It contains fictional data, simulated uploads/TOTP and per-tab state, with no server-side synchronization.

<a id="backups"></a>

## Keep your home

[Backup and restore](BACKUP_RESTORE.md) · [Update](UPDATE.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Access model](LIMITATIONS.md) · [Architecture](ARCHITECTURE.md).

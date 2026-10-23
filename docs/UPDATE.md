# Updating without leaving memories behind

Read the target release notes and manifest. Only update to artifacts whose checksums and image digests you have verified. A database migration may make in-place image downgrade unsafe; **do not promise or attempt arbitrary downgrade**. Recovery means restoring a consistent pre-update backup into a fresh environment and verifying it.

## Before an update

1. Record the current app version, image digests, actual project name, `.env`, all Compose files/overrides and volume mounts. Keep the existing project name, even if it differs from `lovecloud`.
2. Follow [backup instructions](BACKUP_RESTORE.md), keeping the backup password separately. Verify the backup and a test restoration before trusting it.
3. Keep a copy of the previous release installation files/lock alongside the backup. Preserve PostgreSQL **major version 18**, `/var/lib/postgresql` mount layout, originals, secrets, keys and optional proxy/sidecar state.

## Apply a release

Download and verify the target installation archive. Extract it to a separate staging directory first. Review changes, then copy its versioned scripts/config/`compose.images.yaml` into the existing installation directory. Preserve **your** `.env`, `.secrets/`, private proxy values, explicit volume mappings and user overrides. Do not replace them with `.env.example`, and do not rename the existing directory/project to create new empty volumes accidentally.

From that existing installation directory:

```sh
sh scripts/init.sh --start
```

```powershell
./scripts/init.ps1 -Start
```

The persisted Compose list must still include your existing base, new digest lock and supported overrides. Both installers pull and run `--no-build`, then check readiness. They must not generate new DB credentials for an existing database.

Verify login for both partners, ordinary and protected original downloads, TOTP, avatars, posts, planner and wishes. For an additional persistence check:

```sh
docker compose up -d --no-build --force-recreate --wait
```

Use the same persisted project and Compose files. Compare representative download hashes with pre-update hashes. A successful health response alone does not prove that the correct volumes or DataProtection keys were attached.

## If it fails

Keep volumes and logs. Run `docker compose ps` and the [diagnostics](TROUBLESHOOTING.md). Do not use `down -v`, reset setup or erase secrets as a repair. If schema/data compatibility is uncertain, stop writes and use [fresh-target restoration](BACKUP_RESTORE.md) from the pre-update backup. Keep the failed original untouched until restored hashes, accounts and TOTP are verified.

The release manifest records the actual upgrade baseline and PASS/FAIL/NOT RUN evidence. The baseline for v0.1.0 is commit `381a7965e6dab32e7acfc4dfe0184979ceeafab8`; later releases must publish their own tested path.

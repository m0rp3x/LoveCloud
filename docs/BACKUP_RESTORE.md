# Backup and restoration

A complete LoveCloud backup includes PostgreSQL, originals/avatars, DataProtection key ring, secrets and the **effective** installation configuration. Copying only `pgdata` or only photos cannot restore a functioning cloud. Store encrypted backups off-host and keep their password in a separate safe place.

## Create an encrypted backup

Run from the installation directory. The operational scripts use Python 3 and Docker; they use restic in a container rather than requiring a host restic installation.

```sh
sh scripts/backup.sh --repository /safe/lovecloud-backups
```

```powershell
./scripts/backup.ps1 -Repository D:/Backups/LoveCloud
```

The persisted `.env` project/Compose settings are used. If your original project was specified explicitly, pass the **same** `--project original-name` / `-ProjectName original-name`. The scripts stop the API to prevent writes, take a PostgreSQL dump, copy actual mounted files and keys, include configuration and secrets, encrypt through restic, check the repository, and restart the API in a finally path. Plan for that write downtime.

The backup password is `.secrets/backup_password`. **Save a separate offline copy.** It is intentionally excluded from the encrypted backup it unlocks. Neither a backup on the same failed disk nor a password stored only inside its encrypted repository is a recovery strategy.

Do not upload staging directories, setup links, DB dumps or credentials as CI artifacts. Retain only explicit sanitized reports. Temporary plaintext restoration/backup stages must be protected and removed under your normal secure operational procedure.

## Restore into a fresh directory and project

Never test restore over the only live installation. Use a fresh target, distinct project name, unused loopback port and a copy of the backup password:

```sh
sh scripts/restore.sh --repository /safe/lovecloud-backups \
  --password-file /safe/offline/backup_password \
  --target /srv/lovecloud-restored --project lovecloud-restored \
  --origin http://localhost:4321 --port 4321
```

```powershell
./scripts/restore.ps1 -Repository D:/Backups/LoveCloud `
  -PasswordFile D:/Offline/backup_password `
  -Target D:/Restore/LoveCloud -ProjectName lovecloud-restored `
  -Origin http://localhost:4321 -Port 4321
```

The default snapshot is `latest`; choose `--snapshot ID` / `-Snapshot ID` when necessary. The restore refuses an existing target, conflicting containers or restore volumes. It restores the saved installation, changes only the isolated target settings/mount override and restores data. The original installation remains untouched.

Keep PostgreSQL major/layout compatible. HTTPS/Tailscale identity and certificate state require deliberate cutover: do not bring a cloned live Tailscale identity online alongside its original. First verify restored app locally, then configure a distinct sidecar or perform a controlled identity/address cutover. Custom external bind mounts must be reviewed and remapped; never let a test restore attach live paths.

## Verify recovery

1. Log in with the same partner account/password; confirm setup stays closed.
2. Download known ordinary and protected files and compare full SHA-256 hashes.
3. Confirm avatars, folder membership, posts, tasks and wishes.
4. Use the same enrolled authenticator for a fresh TOTP unlock. This checks DataProtection keys survived; do not expose seeds/recovery codes in logs.
5. Recreate containers with the same restored configuration and repeat login/download/TOTP checks.

Restore is not accepted solely because restic reports success. The release manifest reports the exact tested baseline, images and result; a code path or instruction not actually run must remain **NOT RUN**.

## Recovery after an update

Keep the matching pre-update installation files and image lock with the consistent backup. If migrations prevent in-place downgrade, restore that snapshot into a fresh environment using its original version and verify it before cutover. Only claim a specific rollback path after its actual test; do not run old images against an incompatible new schema.

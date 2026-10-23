# Keep your cloud safe

- [Update while preserving project/volumes/secrets](UPDATE.md)
- [Encrypted backup, fresh-target restore and validation](BACKUP_RESTORE.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Architecture and persistent data](ARCHITECTURE.md)
- [Access model and limits](LIMITATIONS.md)
- [Private vulnerability reporting](../SECURITY.md)

Preserve `.env`, all effective Compose files/overrides, secrets, PostgreSQL,
files/avatars and DataProtection key ring as one installation. The scripts use
actual mounted volumes; do not assume their prefix is `lovecloud_`.

Normal recreation is `docker compose up -d --no-build --wait` using that same
configuration. Never remove volumes on a real cloud. An updated image alone is
not a backup or a promise that old images can read a migrated schema.

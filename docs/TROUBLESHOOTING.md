# Troubleshooting

Keep secrets private. Diagnostics should describe the error and the version/image digest; do not post setup fragments, `.secrets`, cookies, DB dumps, tokens, QR codes or recovery codes.

| Symptom | Check / next action |
| --- | --- |
| Docker cannot connect | Start Docker Engine/Desktop, check Linux-container mode and `docker info`. Installer cannot start the daemon for you. |
| Image pull denied | Confirm the digest/tag from the release manifest, registry access and public GHCR package visibility. A public Git repository alone does not make its images public. |
| Health/readiness fails | `docker compose ps`, then `docker compose logs --tail=80 api frontend gateway db`; redact logs before sharing. Preserve data. |
| Existing DB secret missing | Restore the original `.secrets/database_password` and connection secret from your backup. Do not generate a replacement over an existing PG volume. |
| Permission denied reading a secret | Check host file access and bind mount for the non-root process. Re-run the installer using your installation account; avoid world-writable permissions. |
| New empty setup appears after update | Stop writes and compare the actual project, volume mounts and `.env` with your recorded installation. You may have attached new volumes. Do not complete a new setup over the mistake. |
| Setup link already claimed | Resume in the claiming browser. Before completion only, rotate with `--reset-setup-token --start` / `-ResetSetupToken -Start`. Finished setup never reopens. |
| Cannot sign in on HTTPS / CSRF rejected | Exact `APP_ORIGIN` must match scheme/host/port; set secure cookies for HTTPS and preserve proxy forwarding. Do not disable CSRF. |
| TOTP fails after restore | Check server time and restored DataProtection keys; use recovery codes if necessary. Re-enrollment is not a substitute for restoring your original key ring. |
| Live changes stop arriving | Proxy `/hubs/workspace` with WebSocket upgrade and preserve session cookies; verify one API replica. |
| Upload interrupted | Retry the whole file; resumable upload is not implemented. Check proxy/body limit, 5 GiB file limit, quotas and free staging disk. |
| Video does not play | The browser must support the original codec/container. Download it; no transcoding service is included. |
| Preview changes disappear | The GitHub Pages interactive preview intentionally keeps changes only in that tab's memory; refresh/reset discards them. |

Useful commands, from the existing installation directory using its persisted `.env`:

```sh
docker compose ps
docker compose config --images
docker compose logs --tail=80 api frontend gateway
```

Do not paste a full unredacted `docker inspect` or Compose environment dump into issues. Do not repair by deleting volumes (`down -v`) or changing project names. [Report bugs](https://github.com/m0rp3x/LoveCloud/issues/new/choose); [report vulnerabilities privately](../SECURITY.md).

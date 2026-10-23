# Developing from source

Normal users install ready-made [release images](SELF_HOSTING.md). Source development is a separate, explicit mode.

Prerequisites: Git, Docker / Compose, Node.js 24 with npm for frontend checks, .NET SDK 10 for API checks, Python 3 for release helpers. Work in a separate checkout/project using fictional data and separate secrets/volumes. Never point integration tests at a personal cloud.

```sh
git clone https://github.com/m0rp3x/LoveCloud.git
cd LoveCloud
npm ci --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
dotnet restore backend/LoveCloud.Api.csproj
dotnet build backend/LoveCloud.Api.csproj --no-restore
```

For a fresh development installation, generate separate secrets and explicitly
select source mode:

```sh
sh scripts/init.sh --build --start
```

```powershell
./scripts/init.ps1 -Build -Start
```

After secrets/configuration exist, the explicit equivalent source Compose mode is
`docker compose -f compose.yaml -f compose.dev.yaml up -d --build`.
Production setup must not inherit a build section. Keep the exact same project, image configuration and Compose list for subsequent test restarts.

Existing full-stack suites are `scripts/test.ps1`, `scripts/test-onboarding.ps1`, `tests/installers.sh` and `backend/tests/LoveCloud.Checks.csproj`. The PowerShell full-stack suites require `-ImagesFile /path/to/candidate/compose.images.yaml` from a candidate built for your exact source commit; they test pinned images, not unbuilt working files. Setup race checks require `LOVECLOUD_CHECKS_CONNECTION_FILE` pointing to a private connection secret for a disposable PostgreSQL with database creation rights. A skipped race suite is NOT RUN, not PASS.

The authoritative version is root `VERSION`. Candidate images, archive manifest and OCI revision labels must reference one exact, committed SHA. Never rebuild after acceptance while presenting a previous digest as verified. See release workflow and manifest artifacts for actual evidence.

The preview is buildless: `python scripts/release/build-pages.py --output-dir <new-empty-directory>`. Serve it locally for browser checks under a `/LoveCloud/` prefix. It must stay backend-free with local resources, tab-local state, reset and simulated upload/code verification.

[Contributing](../CONTRIBUTING.md) · [Commit style](COMMIT_STYLE.md) · [Brand](BRAND.md) · [Architecture](ARCHITECTURE.md).

# LoveCloud v0.1.0 ♡

A self-hosted home for loving hearts, from the neo_mei team.

Keep memories in hand-drawn folders, leave each other notes, plan together and save little wishes. This first release ships the current feature set for one couple, with English/Russian UI, three themes, avatars and one-time setup.

**Try:** [Interactive preview](https://m0rp3x.github.io/LoveCloud/) — fictional data, per-tab changes, simulated file upload/code verification; no registration or backend.

**Install:** download `lovecloud-v0.1.0-install.tar.gz` or `.zip`, verify `SHA256SUMS`, extract and run `sh scripts/init.sh --start` or `./scripts/init.ps1 -Start`. Ready-made Linux amd64 images are pinned by digest. No Git, Node.js or .NET SDK is required; Docker/Compose and a supported shell are required. [Installation](SELF_HOSTING.md).

**Before real memories:** this is an early release, one pair / one API process, server-side storage without E2EE. Files are at most 5 GiB; no resumable upload, video transcoding or generated thumbnails yet. TOTP protects application access to a shared private area; it does not hide data from the server operator. [Limits](LIMITATIONS.md).

**Existing installations:** preserve project name, actual volumes, secrets, DataProtection key ring, PostgreSQL major/layout, origin and overrides. Create a consistent encrypted backup before updating. [Update](UPDATE.md) · [Restore](BACKUP_RESTORE.md).

The manifest identifies the exact source commit, candidate image digests, upgrade baseline and checks. Its PASS/FAIL/NOT RUN entries are the release's factual acceptance record; this prose does not replace them. Source archives, installation archives, SBOMs, license bundle, source information and checksums accompany the release. Original code: Apache-2.0; third-party materials retain their own terms.

Next separate task: **LC-001 — real thumbnails and a faster gallery**. [Contribute](../CONTRIBUTING.md) · [Private security reports](../SECURITY.md).

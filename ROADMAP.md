# A few wishes for LoveCloud

## Next: LC-001 — real thumbnails and a faster gallery

Generate bounded preview images instead of downloading originals for every gallery tile. Keep originals immutable; enforce authenticated access for shared/private thumbnails; cover cleanup, missing originals, rotation and restored installs. Acceptance: reduced gallery transfer measured on synthetic images, correct access checks, no regression to original hashes, responsive desktop/mobile preview. This is a separate task after v0.1.0.

## Later, separate proposals

- Resumable upload with safe recovery after network interruption.
- Optional S3-compatible storage and a documented migration path.
- Browser-compatible video previews/transcoding with explicit resource limits.
- Mobile application and offline interaction.
- Multi-process API coordination only after redesign of worker/connection state.

These are ideas, not announced deadlines or features included in the first release. [Small contribution ideas](docs/ANNOUNCEMENTS.md#contribution-ideas).

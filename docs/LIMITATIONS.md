# Access model and early-release limits

## Who can enter

One instance serves **one pair** with exactly three slots: administrator and two partners. No open registration or multi-tenancy. The setup wizard closes permanently after successful completion; a rotated setup token cannot reopen a completed cloud. The first partner receives an ordinary session, and the second partner changes the initial password at first login.

The administrator manages installation/accounts. That role does not grant a UI/API bypass into the partners' protected area. The host operator can read disks, secrets and database directly; do not confuse an application role with control of the server.

The private area is **shared by the pair**, with an individual TOTP enrollment and temporary unlock for each partner. Use a compatible authenticator app and keep recovery codes offline. Session/access expiry is checked by the server, including content reads. The private area is not an encrypted vault against the server operator. There is **no end-to-end encryption**, and original blobs are stored server-side. Configure host disk encryption separately if needed.

Wish gift reservations are returned to the reserving partner, not the wish's author. Public activity and SignalR invalidations avoid revealing a reservation to its author. The static preview merely demonstrates this behavior; it does not implement privacy protection.

## Files and storage

- One file: at most **5 GiB**; total instance quota defaults to **100 GiB**, including the private area; protected-area quota is **20 GiB**. Trashed originals continue consuming space until cleanup.
- Avatar uploads: PNG/JPEG/WebP, at most **2 MiB**; decoded images are bounded and normalized to PNG, max 512-pixel side. Avatar previews remain authenticated.
- Browser-supported images/audio/video can be previewed; other formats can be downloaded. Browser codec support varies. No video transcoding or server-side office conversion is supplied.
- File thumbnails currently use original image resources; a dedicated thumbnail pipeline is **not** implemented. The unused Next image optimizer is disabled in the release runtime.
- Upload is a single multipart request streamed to staging. Interrupted requests do not resume: retry the whole file. The API removes incomplete staging when possible and reconciles sufficiently old abandoned files later. Free disk must cover staging plus originals.
- HTTP Range is supported for authenticated content. Proxies must preserve Range and authorization. A network transfer speed or arbitrary concurrent-user capacity is not promised.
- Trash expires after **30 days** through background cleanup. Trash is not a backup.

## Deployment

Release target: **Linux amd64**, one API process, PostgreSQL 18, persistent local volumes. Additional platforms must be marked NOT RUN unless a particular release's manifest proves otherwise. Local HTTP is for loopback. Remote operation requires an exact external origin and HTTPS through Caddy, a configured reverse proxy or optional Tailscale Serve. Preserve project, overrides, secrets and key ring on updates.

## Interactive preview

GitHub Pages hosts a static prototype with fictional names, local SVG illustrations and local OFL fonts. No account is created. Changes live in one tab's memory; refresh or **Reset demo** discards them. Upload is simulated without choosing a real file; demo code **123456** opens an empty mock area. No real TOTP validation, backend persistence, actual file transfer speed or partner synchronization is implied.

Do not enter personal data. The preview prevents backend connections with a restrictive Content Security Policy; normal navigation to the repository/install guide is separate.

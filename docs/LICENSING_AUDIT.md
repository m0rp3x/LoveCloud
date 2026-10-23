# v0.1.0 licensing and media audit

## Scope and ownership

The release applies Apache-2.0 to original LoveCloud code, configuration,
documentation and project vector illustrations. The repository owner explicitly
confirmed their rights to the original code and drawings and authorized their
Apache-2.0 release on 2026-10-23. The confirmed copyright designation is
**Copyright 2026 m0rp3x**. Brand and commit author alone were not used as proof.
Third-party materials remain under their own terms. LICENSE is the complete,
unmodified official Apache-2.0 text; NOTICE preserves attribution without adding
restrictions.

Source: https://www.apache.org/licenses/LICENSE-2.0.txt (retrieved 2026-10-23).

## Fonts and drawings

Caveat, Golos Text and Rubik are local, unmodified font files with their complete
SIL OFL notices retained in frontend/public/fonts, design/assets/fonts and
licenses. The README SVG banner uses font outlines. Standalone SVG icons and
paper-envelope art are project-authored source files, covered by that original-material rights confirmation; they have no embedded external image resources.

## Media disposition

| Material | Known source / evidence | Release action |
| --- | --- | --- |
| docs/assets/*.jpg | Committed docs/assets/README.md says separate synthetic actual-app installation; visual review found local project SVG art and fictional Anya/Misha content | Retained as app screenshots. No tokens, private photos or work addresses visible. |
| design/assets/*preview*.jpg/png and design/strawberry/illustrations/*preview*.jpg/png | Historical design captures; original JS referenced four images.unsplash.com photo IDs, photographer attribution absent | Removed from source tree for this release. Not included in Pages or install artifacts. Earlier Git history is not relicensed by this release. |
| docs/assets/themes.jpg | Old settings screenshot embedded the old theme-card stock-photo pixels | Removed; README uses a safe actual-app Cloud Atelier screenshot instead. |
| frontend/public/themes/*.jpg | Historical prototype screenshots; berry visibly included sea/flower stock photos | Replaced by corresponding actual-app synthetic docs screenshots. |
| design/assets/workspace.js stock URLs | Four Unsplash image URLs, no established photographer/source record | Replaced by local project SVG illustrations. |
| Google Fonts CSS imports | Live third-party fonts.googleapis.com request | Removed for the published strawberry prototype; local fonts/OFL supplied. |

No third-party stock photograph is needed by the distributed preview or current
app theme cards. Synthetic screenshots are not a license grant for any material
someone may upload into their own installation.

## npm / NuGet / native components

Runtime inventory must come from the final candidate image, not all optional
lockfile entries. The release collector records installed package manifests and
license/notice SHA-256s. Direct package declarations and source provenance remain
in package-lock.json / .csproj / packages.lock.json where present.

**sharp/libvips finding:** @img/sharp-libvips-linuxmusl-x64 1.3.4 metadata declares
LGPL-3.0-or-later; its versions.json identifies libvips 8.18.7 and statically
bundled dependencies. The package tarball has a README license table but no
complete corresponding-source bundle. LoveCloud has no next/image usage. The
release explicitly disables the unused Next optimizer and excludes sharp/@img
from the runtime *before final-stage COPY*, preserving them only as build-time
optional dependencies. Final-image and layer inventory must confirm absence.
If the native stack reappears, fail the release gate until full applicable
LGPL notices and matching corresponding source/relinking material are provided.
Do not treat an optional lockfile entry as a binary shipping claim or claim
compliance merely because a file was deleted in a later image layer.

Source: https://registry.npmjs.org/@img/sharp-libvips-linuxmusl-x64/1.3.4 and
https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4 (checked 2026-10-23).

SkiaSharp packages embed native Skia; the collector downloads the exact NuGet
packages recorded in API deps.json and preserves their MIT/BSD/third-party
notices. Runtime distributions, Node.js, PostgreSQL/nginx and optional
Caddy/Tailscale remain separately licensed. Exact-image SBOMs plus collected
OS package metadata/build-source recipes document those deliveries.

## Release evidence

Root LICENSE/NOTICE/THIRD_PARTY_NOTICES/licenses are copied into both own runtime
images, source archives and installation archives; preview artifact includes
root notices and local font OFLs. Collector output and SBOM accompany the
release. Generated image reports identify exact digests. An unresolved source,
license or native payload finding is FAIL / NOT RUN as applicable, never PASS.

# Licenses in the release

`LICENSE` is the unmodified official Apache License 2.0. This directory preserves
third-party terms; these files are not relicensed by LoveCloud.

The release collector inspects the actual API and frontend images, copies
license/notice files, records SHA-256 checksums and installed package versions,
and collects matching native source metadata. Optional lockfile entries are
not treated as installed binaries. The resulting license bundle accompanies the
SBOMs for the exact image digests.

The unused **sharp/libvips** optional stack is excluded from shipped runtime
images before their final COPY; `/_next/image` is disabled. The collector fails
if it finds sharp, @img/sharp-libvips or libvips in final files or image layers.
This avoids distributing an unused native LGPL payload. It remains in npm's
build dependency graph, with its separate license. Reintroducing it requires the
exact corresponding source and build/relinking material for its statically
linked native dependencies; linking only to a license table is insufficient.
See [the audit](../docs/LICENSING_AUDIT.md).

Corresponding sources, recipes and notices for this version are supplied as
[`lovecloud-v0.1.0-third-party-licenses.tar.gz`](https://github.com/m0rp3x/LoveCloud/releases/download/v0.1.0/lovecloud-v0.1.0-third-party-licenses.tar.gz).

For **SkiaSharp**, native notices preserve historical MPL-1.1/GPL/LGPL
tri-license declarations for GIF/mozzconf components. The bundle includes
immutable SkiaSharp build recipes, the exact Skia source submodule and matching
zlib source identified by DEPS, alongside MPL-1.1 text and source checksums.
These upstream components are unmodified by LoveCloud. The collector retains `LICENSE.txt` and
`THIRD-PARTY-NOTICES.txt` from the exact NuGet packages declared by the shipped
API. NuGet package version and SHA-256 are recorded. The .NET runtime's MIT and
third-party notices are included here and in its upstream image.

For infrastructure and distribution packages, consult each exact-image SBOM,
package version, upstream image license directories and source repository. The
collector fails if an expected native license/source bundle cannot be obtained;
do not mark that release gate PASS after bypassing this failure.

Original material ownership and excluded historical media are documented in
[the licensing audit](../docs/LICENSING_AUDIT.md).

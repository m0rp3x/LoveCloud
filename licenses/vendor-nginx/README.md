# Pinned nginx vendor sources and notices

The six real vendor APK identities in `../nginx-vendor-1.31.8.json` come from
nginx image digest `sha256:2db7d28517d1fba17c2da3210395f7be11a11b419246ad0da2edf782af72f367`.
Their missing aports commit is not replaced with an invented Alpine identity.
Unknown image/package versions retain the normal fail-closed source checks.

The catalog records the exact nginx/pkg-oss `1.31.8-1` commit, source archive
SHA256/SHA512 values, packaging checksum members, local QuickJS patch, and exact
upstream license paths. Source release hashes were matched to the immutable
pkg-oss SHA512SUMS. The distributed image COPYRIGHT files are compared with the
same packaging commit during collection.

The full texts here are copied verbatim from their source archives. The generic
BSD-like APK metadata does not replace actual upstream terms: nginx, njs and
pkg-oss use BSD-2-Clause, QuickJS uses MIT, and nginx-acme uses Apache-2.0.

The ACME release Cargo.lock pins 76 registry crate sources by SHA256. The release
bundle retains their complete archives and notices as a lockfile source superset;
this is not a claim that all 76 crates are linked into the binary. An exact
catalog entry chooses the declared Apache-2.0 alternative for http-serde 2.1.1,
which omits a standalone license file, and retains its original author/license
metadata with the full official Apache terms. Unreviewed missing notices fail.

Run the regular release license collector with `--fetch-os-sources` for the final
image set. Its JSON provenance and completion marker are emitted only after all
source hashes, packaging members, real image COPYRIGHTs and crate notices pass.
The separate Docker probe validates this vendor path before a full candidate.

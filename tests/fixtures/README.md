`postgres18-apk-metadata.txt` contains selected package database metadata from
`postgres@sha256:3b0ef735388b2cb097fc29b8bb421d86d57d0ddbe7aa1fbd6493e06d65028503`
(Linux amd64), read from `lib/apk/db/installed` in its OCI filesystem.

The original extracted database SHA256 is
`b07272082393be7c31658e9fc584195919f59bc7267c12da56c26eafbc3f33bc`.
The fixture preserves `P`, `V`, `I`, `o`, `c`, `D`, and `p` fields and at most
one `F` and one `R` field per package. `F`/`R` establish payload presence;
their fixture count is not a complete inventory of installed files. Maintainer
addresses and other unrelated metadata are omitted.

This reproduces the fileless `.postgresql-rundeps` record, its 24 resolved
dependencies, and the 42 actual source origins. Offline tests mock Docker
execution explicitly; they do not certify source acquisition or container
runtime behavior. Release acceptance must run the real pinned-image collector.

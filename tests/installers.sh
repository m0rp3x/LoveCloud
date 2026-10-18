#!/bin/sh
set -eu
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
probe=$(mktemp -d /tmp/lovecloud-install.XXXXXX)
mkdir -p "$probe/scripts"
cp "$source_root/scripts/init.sh" "$probe/scripts/init.sh"
cd "$probe"
printf '%s\r\n' 'APP_ORIGIN="http://localhost:4321"' > .env
sh scripts/init.sh --quiet-secrets > first-output
test "$(tr -d '\r\n' < .secrets/setup_token | wc -c)" -eq 64
grep -q '^http://localhost:4321/setup#token=' .secrets/setup-link.txt
if grep -q '#token=' first-output; then exit 1; fi
cp .secrets/setup_token first-token
cp .secrets/database_password first-password
sh scripts/init.sh --quiet-secrets > second-output
cmp .secrets/setup_token first-token
cmp .secrets/database_password first-password
sh scripts/init.sh > normal-output
grep -q 'Setup link: .*setup#token=' normal-output
sh scripts/init.sh --quiet-secrets --reset-setup-token > reset-output
if cmp -s .secrets/setup_token first-token; then exit 1; fi
cmp .secrets/database_password first-password
test "$(stat -c %a .secrets)" = 700
test "$(stat -c %a .secrets/setup_token)" = 644
test "$(stat -c %a .secrets/database_connection)" = 644
test "$(stat -c %a .secrets/setup-link.txt)" = 600
# Model the individual file mount outside the private host parent.
# This checks actual UID1654 read access rather than trusting mode metadata.
if [ "$(id -u)" = 0 ] && command -v setpriv >/dev/null 2>&1; then
  mounted_probe=$(mktemp -d /tmp/lovecloud-mounted.XXXXXX)
  chmod 755 "$mounted_probe"
  cp -p .secrets/setup_token "$mounted_probe/setup_token"
  setpriv --reuid=1654 --regid=1654 --clear-groups test -r "$mounted_probe/setup_token"
  if setpriv --reuid=1654 --regid=1654 --clear-groups test -r "$probe/.secrets/setup_token"; then exit 1; fi
fi
printf '%s\n' 'PASS Linux installer: private fragment URL, quiet mode, idempotence, explicit reset and file permissions'

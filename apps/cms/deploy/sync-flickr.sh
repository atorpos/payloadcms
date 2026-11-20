#!/usr/bin/env bash
# Run from the host. The secret stays inside the CMS container's environment.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
docker compose exec -T cms node -e '
  const secret = process.env.FLICKR_SYNC_SECRET;
  if (!secret) { console.error("FLICKR_SYNC_SECRET is missing"); process.exit(1); }
  fetch(`http://127.0.0.1:${process.env.PORT || 3006}/api/flickr-sync`, {
    method: "POST", headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  }).then(async (res) => {
    console.log(await res.text());
    if (!res.ok) process.exitCode = 1;
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
'

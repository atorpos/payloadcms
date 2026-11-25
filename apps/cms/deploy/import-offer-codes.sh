#!/usr/bin/env bash
# Adds one-time-use App Store offer codes from App Store Connect's CSV to Offer codes, as available
# (README: "App Store offer codes").
#
#   apps/cms/deploy/import-offer-codes.sh ~/codes.csv --dry-run                         # only check the file
#   apps/cms/deploy/import-offer-codes.sh ~/codes.csv --batch "Launch, November 2026"   # import
#   apps/cms/deploy/import-offer-codes.sh ~/codes.csv --expires 2027-05-24              # with their expiry date
#
# Codes already in the CMS are skipped, so running it again is safe. Delete the CSV from the server
# afterwards: every code in it is a free unlock.
#
# Runs scripts/import-offer-codes.ts in the image's build stage, which has the Payload CLI (the running
# container only has the compiled server). Right after a deploy, that stage comes from the build cache.
set -euo pipefail

csv="${1:-}"

if [[ -z "$csv" || "$csv" == --* ]]; then
  echo "Usage: $0 <codes.csv> [--app <app>] [--batch <name>] [--expires YYYY-MM-DD] [--dry-run]" >&2
  exit 1
fi

if [[ ! -f "$csv" ]]; then
  echo "No such file: $csv" >&2
  exit 1
fi

shift
# Absolute, before changing directory
csv="$(cd "$(dirname "$csv")" && pwd)/$(basename "$csv")"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# shellcheck source=SCRIPTDIR/lib.sh
source "$APP_DIR/deploy/lib.sh"
require_env_file

image=payload-cms-tools
trap 'docker image rm "$image" >/dev/null 2>&1 || true' EXIT

echo "==> Preparing the import tool (takes ~5-10 minutes if the code changed since the last deploy)"
docker build --quiet --file Dockerfile --target builder --tag "$image" ../.. >/dev/null

# The CSV is mounted read-only; nothing of it stays in the image
docker run --rm --network host \
  --env DATABASE_URL="$(env_value DATABASE_URL)" \
  --env PAYLOAD_SECRET="$(env_value PAYLOAD_SECRET)" \
  --env SERVER_URL="$(env_value SERVER_URL)" \
  --volume "$csv:/import/codes.csv:ro" \
  "$image" pnpm --silent payload run scripts/import-offer-codes.ts /import/codes.csv "$@"

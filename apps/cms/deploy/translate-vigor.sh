#!/usr/bin/env bash
# Translates the Vigor website's content that is still in English into Spanish, French and
# Traditional Chinese with Claude (README: "Translating the Vigor website with Claude").
#
#   apps/cms/deploy/translate-vigor.sh --dry-run                  # only show what would be translated
#   apps/cms/deploy/translate-vigor.sh --only=products --limit=5  # five products, to check them first
#   apps/cms/deploy/translate-vigor.sh                            # everything still in English
#
# Needs ANTHROPIC_API_KEY in .env. Runs scripts/translate-vigor.ts in the image's build stage, like
# the import scripts.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# shellcheck source=SCRIPTDIR/lib.sh
source "$APP_DIR/deploy/lib.sh"
require_env_file

# The running CMS's database, Claude, and the website to refresh afterwards. Only keys that are in .env.
env_args=()
for key in DATABASE_URL PAYLOAD_SECRET SERVER_URL S3_BUCKET S3_REGION S3_PREFIX S3_PUBLIC_URL \
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_ENDPOINT S3_FORCE_PATH_STYLE \
  ANTHROPIC_API_KEY TRANSLATE_MODEL TRANSLATE_EFFORT \
  VIGOR_WEBSITE_URL VIGOR_WEBSITE_REVALIDATE_SECRET; do
  if grep -qE "^${key}=" .env; then
    env_args+=(--env "$key=$(env_value "$key")")
  fi
done

image=payload-cms-tools
trap 'docker image rm "$image" >/dev/null 2>&1 || true' EXIT

echo "==> Preparing the translation tool (takes ~5-10 minutes if the code changed since the last deploy)"
docker build --quiet --file Dockerfile --target builder --tag "$image" ../.. >/dev/null

docker run --rm --network host --add-host host.docker.internal:host-gateway \
  "${env_args[@]}" \
  "$image" pnpm --silent payload run scripts/translate-vigor.ts "$@"

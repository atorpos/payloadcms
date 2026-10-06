#!/usr/bin/env bash
# Sends a test email through SendGrid with the settings in .env (README: "Email (SendGrid)").
#
#   apps/cms/deploy/send-test-email.sh you@example.com
#
# "Accepted" only means SendGrid queued the email. Search the printed message ID in SendGrid's
# Activity Feed to see whether it was delivered, deferred, dropped, bounced or blocked.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# shellcheck source=SCRIPTDIR/lib.sh
source "$APP_DIR/deploy/lib.sh"
require_env_file

to="${1:-}"
if [[ ! "$to" =~ ^[^@[:space:]]+@[^@[:space:]]+$ ]]; then
  echo "Usage: $0 <recipient-email>" >&2
  exit 1
fi

api_key="$(env_value SENDGRID_API_KEY)"
from="$(env_value EMAIL_FROM_ADDRESS)"
from_name="$(env_value EMAIL_FROM_NAME)"
api_url="$(env_value SENDGRID_API_URL)"
api_url="${api_url:-https://api.sendgrid.com}"

if [[ -z "$api_key" || -z "$from" ]]; then
  echo "Set SENDGRID_API_KEY and EMAIL_FROM_ADDRESS in $APP_DIR/.env first." >&2
  exit 1
fi

from_domain="${from#*@}"
case "${from_domain,,}" in
  gmail.com | googlemail.com | yahoo.* | outlook.com | hotmail.* | live.com | icloud.com | me.com | aol.com)
    echo "Warning: EMAIL_FROM_ADDRESS is a $from_domain address. Mailbox providers usually reject or hide" >&2
    echo "         mail that claims to come from $from_domain but is sent by SendGrid. Send from your own" >&2
    echo "         domain and authenticate it in SendGrid (README: \"Email (SendGrid)\")." >&2
    ;;
esac

body="$(
  TO="$to" FROM="$from" FROM_NAME="${from_name:-Payload CMS}" python3 -c '
import json, os
print(json.dumps({
  "personalizations": [{"to": [{"email": os.environ["TO"]}]}],
  "from": {"email": os.environ["FROM"], "name": os.environ["FROM_NAME"]},
  "subject": "SendGrid test from Payload CMS",
  "content": [{"type": "text/plain", "value": "If you can read this, email delivery works."}],
}))'
)"

headers="$(mktemp)"
response="$(mktemp)"
trap 'rm -f "$headers" "$response"' EXIT

status="$(
  curl -sS -o "$response" -D "$headers" -w '%{http_code}' -X POST "$api_url/v3/mail/send" \
    -H "Authorization: Bearer $api_key" -H 'Content-Type: application/json' --data "$body"
)"

if [[ "$status" != "202" ]]; then
  echo "SendGrid rejected the email (HTTP $status): $(cat "$response")" >&2
  exit 1
fi

message_id="$(grep -i '^x-message-id:' "$headers" | cut -d' ' -f2 | tr -d '\r')"
echo "SendGrid accepted the email from $from to $to."
echo "Message ID: $message_id"
echo "Check the result in SendGrid: Activity Feed -> search for $to (it can take a minute to appear)."

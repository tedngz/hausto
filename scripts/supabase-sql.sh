#!/usr/bin/env bash
# Run SQL against the linked Supabase project (gbgrwjdmytaksrztcyzs) via the
# Management API. Used because local migration history has drifted from remote
# (Lovable applies migrations directly), making `supabase db push` unsafe.
# Usage: bash scripts/supabase-sql.sh <file.sql>   or   echo "SELECT 1" | bash scripts/supabase-sql.sh
set -euo pipefail

PROJECT_REF="gbgrwjdmytaksrztcyzs"

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  for f in "${APPDATA:-}/supabase/access-token" "$HOME/.supabase/access-token"; do
    if [ -f "$f" ]; then TOKEN=$(cat "$f"); break; fi
  done
fi
if [ -z "$TOKEN" ]; then
  echo "No Supabase access token found (run 'supabase login')." >&2
  exit 1
fi

if [ $# -ge 1 ]; then
  SQL=$(cat "$1")
else
  SQL=$(cat)
fi

# JSON-encode the SQL body with node to handle quotes/newlines safely
BODY=$(node -e "console.log(JSON.stringify({query: require('fs').readFileSync(0,'utf8')}))" <<<"$SQL")

curl -sS -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY"
echo

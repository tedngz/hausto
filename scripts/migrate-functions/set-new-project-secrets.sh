#!/usr/bin/env bash
# Sets runtime secrets on the self-owned Supabase project for migrated edge functions.
# Usage:  ./set-new-project-secrets.sh <project-ref>
set -euo pipefail

PROJECT_REF="${1:-joxxcvxbsjedzkfpmkfc}"

SECRETS=(
  "LOVABLE_DB_URL"
  "LOVABLE_DB_SERVICE_ROLE_KEY"
  "LOVABLE_DB_ANON_KEY"
  "OPENAI_API_KEY"
  "UPSTASH_REDIS_REST_URL"
  "UPSTASH_REDIS_REST_TOKEN"
)

echo "Setting secrets on project: $PROJECT_REF"
echo "Press <enter> with an empty value to SKIP an individual secret."
echo

for name in "${SECRETS[@]}"; do
  read -r -s -p "  $name: " value
  echo
  if [[ -z "$value" ]]; then
    echo "    -> skipped"
    continue
  fi
  supabase secrets set --project-ref "$PROJECT_REF" "$name=$value" >/dev/null
  echo "    -> set"
done

echo
echo "Done. Verify with:  supabase secrets list --project-ref $PROJECT_REF"

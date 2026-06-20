#!/usr/bin/env bash
# Deploys one or more edge functions to the self-owned Supabase project.
# Usage:  ./deploy.sh <project-ref> <function-name> [<function-name> ...]
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <project-ref> <function-name> [<function-name> ...]" >&2
  exit 1
fi

PROJECT_REF="$1"
shift

# Resolve repo root (this script lives in scripts/migrate-functions/).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

for fn in "$@"; do
  if [[ ! -d "supabase/functions/$fn" ]]; then
    echo "✗ supabase/functions/$fn does not exist" >&2
    exit 1
  fi
  echo "→ Deploying $fn to $PROJECT_REF"
  # --no-verify-jwt: functions handle JWT verification in-code against the
  # Lovable-managed auth (different project from the function host).
  supabase functions deploy "$fn" \
    --project-ref "$PROJECT_REF" \
    --no-verify-jwt
done

echo
echo "Done. Logs:  supabase functions logs <name> --project-ref $PROJECT_REF --tail"

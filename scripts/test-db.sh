#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
database_name="friendword_test_$$_${RANDOM}"
database_created=false

cleanup() {
  status=$?
  was_created=$database_created
  drop_succeeded=false
  trap - EXIT
  if [[ $database_created == true ]]; then
    if dropdb "$database_name" >/dev/null 2>&1; then
      drop_succeeded=true
    else
      echo "Database tests failed to drop $database_name" >&2
      status=1
    fi
  fi
  if [[ $status -eq 0 ]]; then
    echo "Database tests passed; dropped $database_name"
  elif [[ $was_created == true && $drop_succeeded == true ]]; then
    echo "Database tests failed with exit $status; dropped $database_name" >&2
  elif [[ $was_created == true ]]; then
    echo "Database tests failed with exit $status; $database_name remains" >&2
  else
    echo "Database tests failed with exit $status; no temporary database was created" >&2
  fi
  exit "$status"
}

trap cleanup EXIT

echo "Creating temporary database $database_name"
createdb "$database_name"
database_created=true

echo "Applying auth stub"
psql -v ON_ERROR_STOP=1 -d "$database_name" -f "$repo_root/supabase/tests/helpers/auth_stub.sql"

for migration in "$repo_root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  psql -v ON_ERROR_STOP=1 -d "$database_name" -f "$migration"
done

echo "Applying seed.sql"
psql -v ON_ERROR_STOP=1 -d "$database_name" -f "$repo_root/supabase/seed.sql"

for test_file in "$repo_root"/supabase/tests/*.sql; do
  echo "Running $(basename "$test_file")"
  psql -v ON_ERROR_STOP=1 -d "$database_name" -f "$test_file"
done

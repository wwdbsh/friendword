#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
database_name="friendword_audit2_$$_${RANDOM}"
database_created=false

case "${PGSERVICE:-}" in
  '') ;;
  *)
    echo "Audit2 runner error: PGSERVICE is not allowed; use a local PostgreSQL target" >&2
    exit 2
    ;;
esac

case "${PGHOST:-}" in
  '' | localhost | 127.0.0.1 | ::1 | /*) ;;
  *)
    echo "Audit2 runner error: PGHOST must be localhost, loopback, or a local socket path" >&2
    exit 2
    ;;
esac

case "${PGHOSTADDR:-}" in
  '' | 127.0.0.1 | ::1) ;;
  *)
    echo "Audit2 runner error: PGHOSTADDR must be loopback" >&2
    exit 2
    ;;
esac

cleanup() {
  status=$?
  was_created=$database_created
  drop_succeeded=false
  trap - EXIT
  if [[ $database_created == true ]]; then
    if dropdb "$database_name" >/dev/null 2>&1; then
      drop_succeeded=true
    else
      echo "Audit2 runner failed to drop $database_name" >&2
      status=1
    fi
  fi
  if [[ $status -eq 0 ]]; then
    echo "Audit2 runner completed; dropped $database_name"
  elif [[ $was_created == true && $drop_succeeded == true ]]; then
    echo "Audit2 runner exited $status; dropped $database_name" >&2
  elif [[ $was_created == true ]]; then
    echo "Audit2 runner exited $status; $database_name remains" >&2
  else
    echo "Audit2 runner exited $status; no temporary database was created" >&2
  fi
  exit "$status"
}

trap cleanup EXIT

echo "Creating temporary audit2 database $database_name"
createdb "$database_name"
database_created=true

echo "Applying auth stub"
psql -X -v ON_ERROR_STOP=1 -d "$database_name" -f "$repo_root/supabase/tests/helpers/auth_stub.sql"

for migration in "$repo_root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  psql -X -v ON_ERROR_STOP=1 -d "$database_name" -f "$migration"
done

echo "Applying seed.sql"
psql -X -v ON_ERROR_STOP=1 -d "$database_name" -f "$repo_root/supabase/seed.sql"

test_files=("$repo_root"/supabase/tests/audit2/b*.sql)
if [[ ${#test_files[@]} -eq 0 || ! -e ${test_files[0]} ]]; then
  echo "Audit2 runner error: no audit2 SQL files found" >&2
  exit 2
fi

passing=0
total=${#test_files[@]}
for test_file in "${test_files[@]}"; do
  test_name="$(basename "$test_file")"
  echo "Running $test_name"
  if psql -X -v ON_ERROR_STOP=1 -d "$database_name" -f "$test_file"; then
    echo "PASS $test_name"
    passing=$((passing + 1))
  else
    echo "FAIL $test_name"
  fi
done

echo "AUDIT2 REGRESSION: $passing/$total passing"
if [[ $passing -ne $total ]]; then
  exit 1
fi

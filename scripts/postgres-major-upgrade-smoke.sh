#!/usr/bin/env bash
set -Eeuo pipefail

# Disposable logical-upgrade rehearsal. It never mounts or modifies the
# project's existing pixsplit_pg volume.
command -v docker >/dev/null 2>&1 || {
  echo "docker CLI is required" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "Docker daemon is not reachable" >&2
  exit 1
}

suffix="${GITHUB_RUN_ID:-local}-$$"
network="pixsplit-pg-upgrade-${suffix}"
source_name="pixsplit-pg16-source-${suffix}"
target_name="pixsplit-pg18-target-${suffix}"
target_volume="pixsplit-pg18-smoke-${suffix}"
db_user="pixsplit_migration"
db_password="$(openssl rand -hex 24)"
db_name="pixsplit_upgrade_rehearsal"
dump_path="/tmp/pixsplit-pg-upgrade-${suffix}.dump"

cleanup() {
  set +e
  docker rm -f -v "$source_name" "$target_name" >/dev/null 2>&1
  docker volume rm "$target_volume" >/dev/null 2>&1
  docker network rm "$network" >/dev/null 2>&1
}
trap cleanup EXIT

wait_for_postgres() {
  local container="$1"
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec "$container" pg_isready -U "$db_user" -d postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  docker logs "$container" >&2
  echo "PostgreSQL did not become ready: $container" >&2
  return 1
}

docker network create "$network" >/dev/null
docker volume create "$target_volume" >/dev/null

# Source: a disposable PostgreSQL 16 cluster, isolated from all project volumes.
docker run -d \
  --name "$source_name" \
  --network "$network" \
  --network-alias pg16-source \
  -e POSTGRES_USER="$db_user" \
  -e POSTGRES_PASSWORD="$db_password" \
  -e POSTGRES_DB=postgres \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1g \
  postgres:16-alpine >/dev/null

# Target: PostgreSQL 18 with the new official-image parent mount layout.
# The temporary named volume is deleted by the EXIT trap.
docker run -d \
  --name "$target_name" \
  --network "$network" \
  -e POSTGRES_USER="$db_user" \
  -e POSTGRES_PASSWORD="$db_password" \
  -e POSTGRES_DB=postgres \
  -v "$target_volume:/var/lib/postgresql" \
  postgres:18-alpine >/dev/null

wait_for_postgres "$source_name"
wait_for_postgres "$target_name"

# Build a representative source database and data marker.
docker exec "$source_name" psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $db_name" >/dev/null
docker exec "$source_name" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE migration_probe (id integer PRIMARY KEY, marker text NOT NULL, payload jsonb NOT NULL)" \
  -c "INSERT INTO migration_probe VALUES (1, 'preserved-through-major-upgrade', '{\"source\":16,\"target\":18}')" >/dev/null

# Use PostgreSQL 18's pg_dump client against the PostgreSQL 16 source.
docker exec -e PGPASSWORD="$db_password" "$target_name" \
  pg_dump -h pg16-source -U "$db_user" -d "$db_name" \
  --format=custom --file="$dump_path"

# Create an empty target database, restore, and verify the data marker.
docker exec "$target_name" psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $db_name" >/dev/null
docker exec "$target_name" pg_restore \
  --exit-on-error --no-owner --no-privileges \
  -U "$db_user" -d "$db_name" "$dump_path"

actual="$(docker exec "$target_name" psql -U "$db_user" -d "$db_name" -At -v ON_ERROR_STOP=1 \
  -c "SELECT marker FROM migration_probe WHERE id = 1")"
if [[ "$actual" != "preserved-through-major-upgrade" ]]; then
  echo "PostgreSQL 16→18 restore verification failed" >&2
  exit 1
fi

json_payload="$(docker exec "$target_name" psql -U "$db_user" -d "$db_name" -At -v ON_ERROR_STOP=1 \
  -c "SELECT payload->>'target' FROM migration_probe WHERE id = 1")"
if [[ "$json_payload" != "18" ]]; then
  echo "PostgreSQL 18 JSONB verification failed" >&2
  exit 1
fi

echo "PostgreSQL 16→18 logical dump/restore rehearsal passed."
echo "Source and target were disposable containers; no project volume was mounted."

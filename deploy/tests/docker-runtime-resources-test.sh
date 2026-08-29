#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

fail() {
  printf 'docker runtime resources test failed: %s\n' "$1" >&2
  exit 1
}

assert_line() {
  file=$1
  line=$2
  grep -Fqx "$line" "$file" || fail "$file is missing: $line"
}

assert_count() {
  file=$1
  line=$2
  expected=$3
  actual=$(grep -Fxc "$line" "$file" || true)
  [ "$actual" -eq "$expected" ] || fail "$file has $actual occurrences of '$line', expected $expected"
}

test -s backend/resources/model-pricing/model_prices_and_context_window.json || \
  fail 'fallback pricing data is missing or empty'

assert_line Dockerfile.goreleaser 'COPY --chown=sub2api:sub2api backend/resources /app/resources'
assert_line deploy/Dockerfile 'COPY --from=backend-builder --chown=sub2api:sub2api /app/backend/resources /app/resources'
assert_count .goreleaser.yaml '      - backend/resources' 4
assert_count .goreleaser.simple.yaml '      - backend/resources' 1

for compose_file in \
  deploy/docker-compose.yml \
  deploy/docker-compose.local.yml \
  deploy/docker-compose.standalone.yml \
  deploy/docker-compose.dev.yml
do
  assert_line "$compose_file" '    mem_limit: ${SUB2API_MEMORY_LIMIT:-1g}'
  assert_line "$compose_file" '    memswap_limit: ${SUB2API_MEMORY_LIMIT:-1g}'
  assert_line "$compose_file" '    mem_reservation: ${SUB2API_MEMORY_RESERVATION:-512m}'
  assert_line "$compose_file" '    cpus: ${SUB2API_CPU_LIMIT:-2}'
done

assert_line Dockerfile 'ENV NODE_OPTIONS=--max-old-space-size=2560'
assert_line Dockerfile 'COPY --from=frontend-builder /app/frontend/package.json /tmp/frontend-build-complete'
assert_line Dockerfile 'ENV GOMEMLIMIT=700MiB'
assert_line Dockerfile 'ENV GOMAXPROCS=2'
assert_line Dockerfile '    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -p=2 \'
assert_line deploy/build_image.sh 'BUILD_MEMORY="${SUB2API_BUILD_MEMORY:-3g}"'
assert_line deploy/build_image.sh 'BUILD_CPUS="${SUB2API_BUILD_CPUS:-2}"'
assert_line .dockerignore 'backend/go.mod.cache/'

printf 'docker runtime resources test passed\n'

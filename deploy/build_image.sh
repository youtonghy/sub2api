#!/usr/bin/env bash
# 本地构建镜像的快速脚本，避免在命令行反复输入构建参数。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILDER_NAME="${SUB2API_BUILDER_NAME:-sub2api-limited}"
BUILD_MEMORY="${SUB2API_BUILD_MEMORY:-3g}"
BUILD_CPUS="${SUB2API_BUILD_CPUS:-2}"

if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
    cpu_period=100000
    cpu_quota=$((BUILD_CPUS * cpu_period))
    docker buildx create \
        --name "${BUILDER_NAME}" \
        --driver docker-container \
        --driver-opt "memory=${BUILD_MEMORY}" \
        --driver-opt "cpu-period=${cpu_period}" \
        --driver-opt "cpu-quota=${cpu_quota}" >/dev/null
fi

# The builder container owns every compiler process, so its cgroup limit also
# covers native helpers such as esbuild that are outside Node's heap limit.
docker buildx inspect --builder "${BUILDER_NAME}" --bootstrap >/dev/null
builder_container="buildx_buildkit_${BUILDER_NAME}0"
docker update \
    --memory "${BUILD_MEMORY}" \
    --memory-swap "${BUILD_MEMORY}" \
    --cpu-period 100000 \
    --cpu-quota $((BUILD_CPUS * 100000)) \
    "${builder_container}" >/dev/null
trap 'docker buildx stop "${BUILDER_NAME}" >/dev/null 2>&1 || true' EXIT

docker buildx build --builder "${BUILDER_NAME}" --load -t sub2api:latest \
    --build-arg GOPROXY=https://goproxy.cn,direct \
    --build-arg GOSUMDB=sum.golang.google.cn \
    -f "${REPO_ROOT}/Dockerfile" \
    "${REPO_ROOT}"

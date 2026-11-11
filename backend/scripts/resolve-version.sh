#!/bin/sh
set -eu

# RetooAi 的程序版本号使用打包时间（YYMMDDHHmm，例如 2611111054 表示 2026-11-11 10:54）。
# 所基于的上游版本单独记录在 cmd/server/VERSION 中并内嵌进二进制，不由本脚本输出。
#
# 时区默认 UTC+8（POSIX 写法 CST-8，不依赖 tzdata），可用 VERSION_TZ 覆盖，例如 VERSION_TZ=UTC。
TZ="${VERSION_TZ:-CST-8}" date +%y%m%d%H%M

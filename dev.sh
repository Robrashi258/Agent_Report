#!/bin/bash
# 随手计划 - 开发启动脚本
# 用途：清除宿主环境可能设置的 ELECTRON_RUN_AS_NODE（会让 Electron 退化为纯 Node 模式）
cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
exec node node_modules/electron-vite/bin/electron-vite.js dev "$@"

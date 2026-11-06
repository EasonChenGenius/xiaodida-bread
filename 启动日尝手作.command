#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '请先安装 Node.js 24 LTS，再重新打开此文件。'
  read '?按回车关闭…'
  exit 1
fi
print '日尝手作 · 本机配送服务'
print '请保留这个终端窗口；关闭窗口或按 Ctrl+C 会停止小程序接口。'
node scripts/local-dev.mjs
startup_result=$?
if [[ $startup_result == 2 ]]; then
  read '?已有服务继续运行，本窗口未启动第二份服务。按回车关闭此窗口…'
elif [[ $startup_result == 0 ]]; then
  read '?本窗口的服务已停止，按回车关闭…'
else
  read '?本次启动未成功，请查看上方原因。按回车关闭…'
fi

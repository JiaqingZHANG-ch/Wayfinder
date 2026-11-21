# 运行每日规划师。用法：.\run.ps1 examples\2026-11-16.json -o out.json
. (Join-Path $PSScriptRoot '..\..\..\加载AI工作空间.ps1')
Set-Location -LiteralPath $PSScriptRoot
uv run python -m planner @args

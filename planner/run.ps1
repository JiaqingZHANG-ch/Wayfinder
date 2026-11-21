# 运行每日规划师。用法：.\run.ps1 examples\2026-11-16.json -o out.json
$ws = Join-Path $PSScriptRoot '..\..\..\加载AI工作空间.ps1'  # 作者本机的工作空间设置；别的电脑上没有就跳过
if (Test-Path -LiteralPath $ws) { . $ws }
Set-Location -LiteralPath $PSScriptRoot
uv run python -m planner @args

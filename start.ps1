# 启动成长导师。用法：在 PowerShell 里运行  .\start.ps1  然后用浏览器打开 http://127.0.0.1:8765
# 需要先设好环境变量 DEEPSEEK_API_KEY（AI工作空间\配置DeepSeek密钥.ps1 已经设过就不用再设）。
. (Join-Path $PSScriptRoot '..\..\加载AI工作空间.ps1')
Set-Location -LiteralPath $PSScriptRoot
$env:PYTHONPATH = 'src'
uv run python -m mentor

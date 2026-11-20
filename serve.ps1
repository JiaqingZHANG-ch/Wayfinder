# 启动合并版 App 的后端。用法：在 PowerShell 里运行  .\serve.ps1  然后用浏览器打开 http://127.0.0.1:8000/docs
# 换模型：先运行  $env:MODEL = 'ollama'  （或 fake、deepseek）再启动；不设就是 fake（假模型，一句话解析会让你点按钮）。
. (Join-Path $PSScriptRoot '..\..\加载AI工作空间.ps1')
Set-Location -LiteralPath $PSScriptRoot
$env:PYTHONPATH = 'src'
uv run python -m server
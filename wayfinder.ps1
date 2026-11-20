# 一键打开 Wayfinder：本机 Ollama（qwen3:14b）+ 后端 + 网页版，然后用浏览器打开 http://localhost:8081
# 用法：在 PowerShell 里运行  .\wayfinder.ps1  。会开出三个窗口（Ollama、后端、网页），关掉窗口就停。
# 换模型：先运行  $env:MODEL = 'fake'  （不用模型）或 'deepseek'（要先设 DEEPSEEK_API_KEY）再启动。
. (Join-Path $PSScriptRoot '..\..\加载AI工作空间.ps1')
if (-not $env:MODEL) { $env:MODEL = 'ollama' }

function Test-Port([int]$port) {
    try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', $port); $true } catch { $false }
}

function Start-Window([string]$script) {
    Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-File', $script
}

if ($env:MODEL -eq 'ollama' -and -not (Test-Port 11434)) {
    Start-Window (Join-Path $PSScriptRoot '..\..\工具与运行环境\Ollama-启动.ps1')
}
if (-not (Test-Port 8000)) { Start-Window (Join-Path $PSScriptRoot 'serve.ps1') }  # 新窗口继承 $env:MODEL
if (-not (Test-Port 8081)) { Start-Window (Join-Path $PSScriptRoot 'web.ps1') }

Write-Output "模型：$env:MODEL。等网页版起来（第一次要半分钟左右）……"
for ($i = 0; $i -lt 120 -and -not (Test-Port 8081); $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Port 8081)) { throw '网页版两分钟还没起来：看一下「web.ps1」那个窗口里的报错。' }
Start-Process 'http://localhost:8081'

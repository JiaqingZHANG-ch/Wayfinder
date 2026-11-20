# 启动 App 的网页版。用法：先运行 .\serve.ps1（后端），再在另一个窗口运行  .\web.ps1  ，浏览器打开 http://localhost:8081
. (Join-Path $PSScriptRoot '..\..\加载AI工作空间.ps1')
Set-Location -LiteralPath (Join-Path $PSScriptRoot 'mobile')
npx expo start --web --port 8081
# 用 iPhone 上的 Expo Go 打开 App。手机和电脑要连同一个 Wi-Fi。
# 1. 先另开一个窗口：  $env:HOST = '0.0.0.0'; .\serve.ps1   （后端对局域网开放；只在自己家的网络这样做）
# 2. 再运行本脚本，用 iPhone 相机扫终端里的二维码。
. (Join-Path $PSScriptRoot '..\..\加载AI工作空间.ps1')
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -eq 'Dhcp' } | Select-Object -First 1).IPAddress
if (-not $ip) { throw '没找到这台电脑的局域网地址：连上 Wi-Fi 了吗？' }
$env:EXPO_PUBLIC_API_URL = "http://${ip}:8000"
Write-Output "手机会连这个后端：$env:EXPO_PUBLIC_API_URL"
Set-Location -LiteralPath (Join-Path $PSScriptRoot 'mobile')
npx expo start
# install-association.ps1 —— 把 .md / .markdown 的双击默认程序设为本目录的预览器
# 只写 HKCU（当前用户），不需要管理员权限；随时可用 uninstall-association.ps1 还原

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs  = Join-Path $here 'md-open.vbs'
$js   = Join-Path $here 'md-open.js'
$viewer = Join-Path $here '..\Markdown预览器.html'

foreach ($f in @($vbs, $js)) {
  if (-not (Test-Path $f)) { throw "缺少文件：$f" }
}
if (-not (Test-Path $viewer)) {
  throw "找不到预览器：$viewer`n请把 bin 目录和 Markdown预览器.html 保持在同一个仓库里再运行。"
}

$progId = 'MDPreview'
$cls    = "HKCU:\Software\Classes\$progId"
$command = 'wscript.exe //nologo "' + $vbs + '" "%1"'

# 1) 程序标识
New-Item -Path "$cls\shell\open\command" -Force | Out-Null
Set-Item -Path $cls -Value 'Markdown 预览器'
Set-ItemProperty -Path $cls -Name 'FriendlyTypeName' -Value 'Markdown 文档（MD 预览器）'
New-Item -Path "$cls\DefaultIcon" -Force | Out-Null
Set-Item -Path "$cls\DefaultIcon" -Value '%SystemRoot%\system32\shell32.dll,70'
Set-ItemProperty -Path "$cls\shell\open\command" -Name '(default)' -Value $command

# 2) 扩展名指向程序标识，并保留「打开方式」列表里的候选
foreach ($ext in @('.md', '.markdown')) {
  $extKey = "HKCU:\Software\Classes\$ext"
  New-Item -Path $extKey -Force | Out-Null
  Set-ItemProperty -Path $extKey -Name '(default)' -Value $progId
  Set-ItemProperty -Path $extKey -Name 'Content Type' -Value 'text/markdown'
  New-Item -Path "$extKey\OpenWithProgids" -Force | Out-Null
  New-ItemProperty -Path "$extKey\OpenWithProgids" -Name $progId -PropertyType Binary -Value ([byte[]]@()) -Force | Out-Null
}

# 3) 通知资源管理器刷新文件关联
try {
  Add-Type -Namespace MdPreview -Name ShellNotify -MemberDefinition @'
[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);
'@ -ErrorAction SilentlyContinue
  [MdPreview.ShellNotify]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
} catch { }

Write-Host ''
Write-Host '  已设置：双击 .md 用 MD 预览器打开' -ForegroundColor Green
Write-Host "  程序标识：$progId"
Write-Host "  启动命令：$command"
Write-Host ''
$checkOut = (reg query "HKCR\.md" 2>$null | Out-String)
$ok = $checkOut -match [regex]::Escape($progId)
Write-Host ("  注册表当前关联：" + $(if ($ok) { "$progId（已生效）" } else { '（未读到，请直接双击一个 .md 验证）' }))
Write-Host ''
Write-Host '  提示：系统的 assoc 命令不显示用户级关联，请直接双击一个 .md 验证。' -ForegroundColor DarkGray
Write-Host '  如果资源管理器还没生效：注销/重登一次，或右键 .md → 打开方式 → 选择其他应用 → MD 预览器 → 始终使用。' -ForegroundColor DarkGray
Write-Host ''

# uninstall-association.ps1 —— 还原 .md / .markdown 的默认程序设置
# 只操作 HKCU，不需要管理员权限

$ErrorActionPreference = 'Continue'

$progId = 'MDPreview'
$cls = "HKCU:\Software\Classes\$progId"

# 1) 删掉程序标识
if (Test-Path $cls) {
  Remove-Item -Path $cls -Recurse -Force -ErrorAction SilentlyContinue
}

# 2) 清掉扩展名上的关联
#    注意：Remove-ItemProperty 对默认值 '(default)' 不可靠，这里用 reg delete /ve
foreach ($ext in @('.md', '.markdown')) {
  $full = "HKCU\Software\Classes\$ext"
  $exists = (reg query $full 2>$null) -ne $null
  if ($exists) {
    reg delete $full /ve /f 2>$null | Out-Null
    reg delete $full /v "Content Type" /f 2>$null | Out-Null
    reg delete "$full\OpenWithProgids" /v $progId /f 2>$null | Out-Null
  }
}

# 3) 通知资源管理器刷新
try {
  Add-Type -Namespace MdPreview -Name ShellNotify -MemberDefinition @'
[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);
'@ -ErrorAction SilentlyContinue
  [MdPreview.ShellNotify]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
} catch { }

# 4) 校验结果
$mdDefault = (reg query "HKCU\Software\Classes\.md" /ve 2>$null | Out-String)
$stillThere = $mdDefault -match [regex]::Escape($progId)

Write-Host ''
if ($stillThere) {
  Write-Host '  还原未完成：.md 仍指向 MDPreview' -ForegroundColor Red
  $mdDefault | Write-Host
} else {
  Write-Host '  已还原：.md / .markdown 不再默认用 MD 预览器打开（文件本身没有任何删改）' -ForegroundColor Yellow
}
Write-Host "  程序标识 MDPreview 已删除：$(-not (Test-Path $cls))"
Write-Host ''

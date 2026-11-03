' md-open.vbs -- Explorer entry point: launch md-open.js hidden, then exit.
' Argument 1: path to the Markdown file that was double-clicked.
' Kept ASCII-only on purpose: WSH reads .vbs as ANSI, so non-ASCII source
' would be mis-decoded on Chinese-locale Windows.
Option Explicit

Dim fso, sh, here, nodeExe, scriptPath, target, cmd, logFile, logDir

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

If WScript.Arguments.Count = 0 Then
  WScript.Quit 0
End If

here = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(here, "md-open.js")
target = WScript.Arguments(0)

nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then
  nodeExe = "node"
End If

If Not fso.FileExists(scriptPath) Then
  MsgBox "md-open.js not found:" & vbCrLf & scriptPath, 16, "MD Previewer"
  WScript.Quit 1
End If

cmd = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & scriptPath & Chr(34) & " " & Chr(34) & target & Chr(34)

On Error Resume Next
sh.Run cmd, 0, False
If Err.Number <> 0 Then
  logDir = fso.GetSpecialFolder(2) & "\md-preview"
  If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir
  logFile = fso.BuildPath(logDir, "launcher-error.log")
  Dim ts
  Set ts = fso.OpenTextFile(logFile, 8, True)
  ts.WriteLine "[" & Now & "] " & Err.Number & ": " & Err.Description
  ts.WriteLine "  cmd: " & cmd
  ts.Close
  MsgBox "Failed to start previewer." & vbCrLf & Err.Description, 16, "MD Previewer"
End If
On Error GoTo 0

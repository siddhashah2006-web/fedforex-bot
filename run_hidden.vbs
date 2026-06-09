' Fed Forex — launches a Node script with NO visible window.
' Usage: wscript run_hidden.vbs "C:\full\path\to\script.js"
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Program Files\nodejs\node.exe"" """ & WScript.Arguments(0) & """", 0, False

#!/bin/zsh
# Ресурсная панель v8: окно 1 — полное, окно 2 — узкое (мобильная ширина)
DIR="$(cd "$(dirname "$0")" && pwd)"
open -a "Google Chrome"; sleep 2
osascript <<OSA
tell application "Google Chrome"
  -- закрыть ранее открытые окна панели
  repeat with w in (every window)
    if (URL of active tab of w) contains "/panel-v8/index.html" then close w
  end repeat
  set f to make new window
  set URL of active tab of f to "file://$DIR/index.html"
  set bounds of f to {0, 25, 1728, 1117}
  set m to make new window
  set URL of active tab of m to "file://$DIR/index.html"
  set bounds of m to {-440, 380, -20, 1260}
  activate
end tell
OSA

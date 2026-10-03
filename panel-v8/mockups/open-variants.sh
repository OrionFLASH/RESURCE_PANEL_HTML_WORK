#!/bin/zsh
# Вариант E: окно 1 — полные версии (по вкладке на вариант), окно 2 — узкое, мобильные версии (по вкладке на вариант)
DIR="$(cd "$(dirname "$0")" && pwd)"
V=(variant-E-launcher)
open -a "Google Chrome"; sleep 2
osascript <<OSA
tell application "Google Chrome"
  -- закрыть ранее открытые окна макетов
  repeat with w in (every window)
    if (URL of active tab of w) contains "/mockups/variant-" then close w
  end repeat
  set f to make new window
  set URL of active tab of f to "file://$DIR/${V[1]}.html"
  set bounds of f to {0, 25, 1728, 1117}
  set m to make new window
  set URL of active tab of m to "file://$DIR/${V[1]}.html#mobile"
  set bounds of m to {-440, 380, -20, 1260}
  set active tab index of f to 1
  set active tab index of m to 1
  activate
end tell
OSA

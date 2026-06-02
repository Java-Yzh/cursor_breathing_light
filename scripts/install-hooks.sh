#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CURSOR_DIR="$HOME/.cursor"
HOOKS_DIR="$CURSOR_DIR/hooks"
HOOKS_JSON="$CURSOR_DIR/hooks.json"
HOOK_SCRIPT="$HOOKS_DIR/breathing-light-update.ts"
SOURCE_SCRIPT="$REPO_ROOT/hooks/update-state.ts"

EVENTS="beforeSubmitPrompt,sessionStart,preToolUse,postToolUse,postToolUseFailure,afterFileEdit,afterAgentThought,stop,sessionEnd"

mkdir -p "$HOOKS_DIR"
cp "$SOURCE_SCRIPT" "$HOOK_SCRIPT"
chmod +x "$HOOK_SCRIPT"

if command -v node >/dev/null 2>&1; then
  cat > "$HOOKS_DIR/breathing-light-update.sh" << 'WRAPPER'
#!/usr/bin/env bash
exec node --experimental-strip-types "$HOME/.cursor/hooks/breathing-light-update.ts"
WRAPPER
  chmod +x "$HOOKS_DIR/breathing-light-update.sh"
  HOOK_ENTRY='{"command": "./hooks/breathing-light-update.sh"}'
  echo "Using Node for hook script."
else
  echo "Error: install Node.js 22+ to run hooks." >&2
  exit 1
fi

if [[ ! -f "$HOOKS_JSON" ]]; then
  cat > "$HOOKS_JSON" << EOF
{
  "version": 1,
  "hooks": {}
}
EOF
fi

export HOOKS_JSON HOOK_ENTRY EVENTS

node << 'NODEJS'
const fs = require('fs');

const hooksJsonPath = process.env.HOOKS_JSON;
const hookEntry = JSON.parse(process.env.HOOK_ENTRY);
const events = process.env.EVENTS.split(',');

const config = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
config.version = config.version ?? 1;
config.hooks = config.hooks ?? {};

for (const event of events) {
  const list = config.hooks[event] ?? [];
  const already = list.some(
    (h) =>
      h.command === hookEntry.command ||
      h.command?.includes('breathing-light-update')
  );
  if (!already) {
    list.push(hookEntry);
  }
  config.hooks[event] = list;
}

fs.writeFileSync(hooksJsonPath, JSON.stringify(config, null, 2) + '\n');
console.log('Updated', hooksJsonPath);
NODEJS

echo ""
echo "Breathing Light hooks installed."
echo "  Hook script: $HOOK_SCRIPT"
echo "  Config:      $HOOKS_JSON"
echo ""
echo "Restart Cursor, then run: npm run menubar"

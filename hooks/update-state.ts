#!/usr/bin/env node
/**
 * Cursor hook: maps agent events to breathing-light activity state.
 * Deployed to ~/.cursor/hooks/breathing-light-update.ts via install-hooks.sh
 * Runs with: node --experimental-strip-types (Node 22+) or bun
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stdin } from 'node:process';

type ActivityState = 'idle' | 'thinking' | 'coding';

interface HookInput {
  hook_event_name: string;
  conversation_id?: string;
  tool_name?: string;
}

const WRITE_TOOLS = new Set([
  'Write',
  'StrReplace',
  'EditNotebook',
  'Delete',
  'TabWrite',
]);

const STATE_DIR = join(homedir(), '.cursor', 'breathing-light');
const STATE_FILE = join(STATE_DIR, 'state.json');
const HTTP_URL = 'http://127.0.0.1:39281/state';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    stdin.on('end', () => resolve(Buffer.concat(chunks).toString()));
    stdin.on('error', () => resolve(''));
  });
}

function resolveState(input: HookInput): ActivityState | null {
  const event = input.hook_event_name;

  switch (event) {
    case 'stop':
    case 'sessionEnd':
      return 'idle';

    case 'beforeSubmitPrompt':
    case 'sessionStart':
    case 'afterAgentThought':
    case 'postToolUseFailure':
      return 'thinking';

    case 'preToolUse':
      if (input.tool_name && WRITE_TOOLS.has(input.tool_name)) {
        return 'coding';
      }
      return 'thinking';

    case 'postToolUse':
      return 'thinking';

    case 'afterFileEdit':
    case 'afterTabFileEdit':
      return 'coding';

    default:
      return null;
  }
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: HookInput = { hook_event_name: '' };

  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    console.log('{}');
    process.exit(0);
  }

  const state = resolveState(input);
  if (!state) {
    console.log('{}');
    process.exit(0);
  }

  const payload = {
    state,
    updated_at: Date.now(),
    source: input.hook_event_name,
    conversation_id: input.conversation_id,
  };

  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(payload, null, 2));

  try {
    await fetch(HTTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(500),
    });
  } catch {
    // Menubar app may not be running — state file is the fallback.
  }

  console.log('{}');
  process.exit(0);
}

main().catch(() => {
  console.log('{}');
  process.exit(0);
});

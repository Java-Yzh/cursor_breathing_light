export type ActivityState = 'idle' | 'thinking' | 'coding';

export interface StatePayload {
  state: ActivityState;
  updated_at: number;
  source: string;
  conversation_id?: string;
}

export const STATE_FILE = `${process.env.HOME}/.cursor/breathing-light/state.json`;
export const HTTP_PORT = 39281;
export const HTTP_HOST = '127.0.0.1';

export const WRITE_TOOLS = new Set([
  'Write',
  'StrReplace',
  'EditNotebook',
  'Delete',
  'TabWrite',
]);

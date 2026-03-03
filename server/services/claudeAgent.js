/**
 * Claude AI agent with tool use for OmniWall.
 * Each socket session gets its own conversation history.
 * Tool calls that modify the system require voice confirmation via onAsk().
 */

import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'child_process';
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { dirname } from 'path';

// Per-socket conversation histories (cleared on disconnect)
const histories = {};

const MODEL = 'claude-sonnet-4-6';

const TOOLS = [
  {
    name: 'bash',
    description: 'Execute a bash shell command on the Raspberry Pi. Use for running scripts, installing packages, checking system state, creating files, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command:     { type: 'string', description: 'The bash command to execute' },
        description: { type: 'string', description: 'Plain-English description of what this command does, spoken to the user for approval' },
        safe:        { type: 'boolean', description: 'True if this is a read-only/non-destructive command (ls, cat, grep, echo, pwd…). False if it modifies files, installs packages, or runs processes.' },
      },
      required: ['command', 'description', 'safe'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file on disk.',
    input_schema: {
      type: 'object',
      properties: {
        path:        { type: 'string', description: 'Absolute or ~ path to the file' },
        content:     { type: 'string', description: 'File content to write' },
        description: { type: 'string', description: 'Plain-English description of what this file does, spoken to the user for approval' },
      },
      required: ['path', 'content', 'description'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (default: /home/pi)' },
      },
      required: [],
    },
  },
];

function getSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `You are Claude, an AI assistant running on a Raspberry Pi 5 home dashboard called OmniWall.
Current date and time: ${dateStr}, ${timeStr}.
Home directory: /home/pi
OmniWall project: /home/pi/Documents/omni (Bun + Express + React)

You can execute bash commands, read and write files, and help with any coding or system tasks.
For bash commands and file writes, always set safe=false and a clear description — the user will approve them by voice.
For read-only bash commands (ls, cat, grep, echo, pwd, which…), set safe=true to skip confirmation.
Keep your spoken responses short and clear — they will be read aloud via text-to-speech.
Reply in the same language the user used.`;
}

async function executeTool(name, input) {
  if (name === 'bash') {
    return new Promise((resolve) => {
      execFile('bash', ['-c', input.command], {
        timeout: 60000,
        maxBuffer: 512 * 1024,
        env: { ...process.env, HOME: '/home/pi' },
      }, (err, stdout, stderr) => {
        const out = (stdout + (stderr ? `\nstderr: ${stderr}` : '')).trim();
        resolve(out || (err ? `Error: ${err.message}` : 'Command completed (no output).'));
      });
    });
  }

  if (name === 'write_file') {
    const p = input.path.replace(/^~/, process.env.HOME || '/home/pi');
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, input.content, 'utf8');
    return `File written: ${p} (${input.content.length} chars)`;
  }

  if (name === 'read_file') {
    const p = input.path.replace(/^~/, process.env.HOME || '/home/pi');
    try {
      const content = await readFile(p, 'utf8');
      return content.slice(0, 8000) + (content.length > 8000 ? '\n[truncated]' : '');
    } catch (err) {
      return `Error reading file: ${err.message}`;
    }
  }

  if (name === 'list_directory') {
    const p = (input.path || '/home/pi').replace(/^~/, process.env.HOME || '/home/pi');
    try {
      const entries = await readdir(p, { withFileTypes: true });
      return entries.map(e => `${e.isDirectory() ? 'd' : 'f'}  ${e.name}`).join('\n');
    } catch (err) {
      return `Error listing directory: ${err.message}`;
    }
  }

  return `Unknown tool: ${name}`;
}

/**
 * Run a Claude agent turn.
 *
 * @param {string}   text       - The user's spoken command
 * @param {string}   socketId   - Socket ID (for conversation history)
 * @param {Function} emit       - (event, data) => void — send socket events to client
 * @param {Function} onAsk      - (question, timeoutMs) => Promise<string> — get voice confirmation
 */
export async function runClaudeAgent({ text, socketId, emit, onAsk }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit('agent:done', { text: 'Claude is not configured. Please add ANTHROPIC_API_KEY to the server .env file.' });
    return;
  }

  if (!histories[socketId]) histories[socketId] = [];
  const history = histories[socketId];
  history.push({ role: 'user', content: text });

  const client = new Anthropic({ apiKey });

  emit('agent:status', { text: 'Thinking…' });

  // Agentic loop
  for (let turn = 0; turn < 10; turn++) {
    let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: getSystemPrompt(),
        tools: TOOLS,
        messages: history,
      });
    } catch (err) {
      console.error('[ClaudeAgent] API error:', err);
      emit('agent:error', { text: `Claude API error: ${err.message}` });
      return;
    }

    // Add assistant turn to history
    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      emit('agent:done', { text: textBlock?.text?.trim() || 'Done.' });
      return;
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const { id, name, input } = block;
        const needsConfirm = (name === 'write_file') || (name === 'bash' && !input.safe);

        if (needsConfirm) {
          const question = `I need to ${input.description}. Shall I proceed?`;
          emit('agent:ask', { text: question, timeout: 25000 });

          let answer = '';
          try {
            answer = await onAsk(socketId, 25000);
          } catch {
            emit('agent:done', { text: 'Action cancelled — no response received.' });
            return;
          }

          const approved = /yes|yeah|sure|ok|okay|go|do it|proceed|confirm|yep|igen|persze|jó|mehet/i.test(answer);
          if (!approved) {
            emit('agent:status', { text: `Skipping: ${input.description}` });
            toolResults.push({ type: 'tool_result', tool_use_id: id, content: 'User declined this action.' });
            continue;
          }
        }

        emit('agent:status', { text: `Running: ${input.description || name}…` });
        const result = await executeTool(name, input);
        console.log(`[ClaudeAgent] Tool ${name} result:`, result.slice(0, 200));
        toolResults.push({ type: 'tool_result', tool_use_id: id, content: result });
      }

      history.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason
    emit('agent:done', { text: 'Done.' });
    return;
  }

  emit('agent:done', { text: 'Reached maximum steps. Please try a simpler request.' });
}

/** Clear conversation history for a socket (call on disconnect) */
export function clearClaudeHistory(socketId) {
  delete histories[socketId];
}

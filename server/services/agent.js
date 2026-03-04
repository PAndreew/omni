import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const PI_PATH = '/usr/lib/node_modules/@mariozechner/pi-coding-agent';
const { 
  createAgentSession, 
  SessionManager, 
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry
} = require(`${PI_PATH}/dist/index.js`);

const { Type } = require(`${PI_PATH}/node_modules/@sinclair/typebox`);

import db from '../db.js';

let session = null;        // kimi-k2.5 — general tasks
let complexSession = null; // claude-sonnet — coding / complex tasks
const OMNI_PORT = process.env.PORT || 3001;

const COMPLEX_KEYWORDS = ['code', 'script', 'file', 'write', 'debug', 'install', 'run', 'bash', 'fix', 'create', 'edit', 'program'];

export function isComplexTask(text) {
  const lower = text.toLowerCase();
  return COMPLEX_KEYWORDS.some(k => lower.includes(k));
}

/**
 * Initialize the Omni coding agent session.
 * We provide it with custom tools to interact with the Omni system.
 */
export async function initAgent(io) {
  try {
    const authStorage = AuthStorage.create();
    const modelRegistry = new ModelRegistry(authStorage);

    // Register OpenRouter as a custom provider
    const orKey = process.env.OPENROUTER_API_KEY;
    if (orKey) {
      modelRegistry.registerProvider('openrouter', {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: orKey,
        authHeader: true,
        api: 'openai-completions',
        models: [
          // Non-reasoning — content comes back normally
          { id: 'moonshotai/kimi-k2',          name: 'Kimi K2',            api: 'openai-completions', contextWindow: 131072, maxTokens: 16384, reasoning: false, input: ['text'] },
          // Reasoning model — pi-ai openai-completions provider handles anthropic/ via OpenRouter specially
          { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5',  api: 'openai-completions', contextWindow: 200000, maxTokens: 16384, reasoning: true,  input: ['text'], compat: { thinkingBudget: 8000 } },
        ],
      });
      console.log('[Agent] OpenRouter provider registered.');
    } else {
      console.warn('[Agent] OPENROUTER_API_KEY missing — using default model.');
    }
    
    // Custom tools for the agent to control Omni
    const omniTools = [
      {
        name: 'get_chores',
        label: 'Get Chores',
        description: 'Returns the list of all chores (tasks).',
        parameters: Type.Object({}),
        execute: async () => {
          const chores = db.prepare(`
            SELECT * FROM chores 
            ORDER BY 
              done ASC, 
              CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, 
              due_date ASC, 
              created_at DESC
          `).all();
          return { content: [{ type: 'text', text: JSON.stringify(chores, null, 2) }] };
        }
      },
      {
        name: 'add_chore',
        label: 'Add Chore',
        description: 'Adds a new chore to the list.',
        parameters: Type.Object({
          title: Type.String({ description: 'The task description' }),
          assignee: Type.Optional(Type.String({ description: 'Who is responsible' })),
          priority: Type.Optional(Type.String({ enum: ['low', 'medium', 'high'] })),
          due_date: Type.Optional(Type.String({ description: 'Due date in YYYY-MM-DD format' })),
          repeat_interval: Type.Optional(Type.String({ enum: ['daily', 'weekly', 'monthly'], description: 'Optional repeat interval' })),
        }),
        execute: async (id, { title, assignee = '', priority = 'medium', due_date = null, repeat_interval = null }) => {
          const result = db.prepare('INSERT INTO chores (title, assignee, priority, due_date, repeat_interval) VALUES (?, ?, ?, ?, ?)')
                           .run(title, assignee, priority, due_date, repeat_interval);
          const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(result.lastInsertRowid);
          io.emit('chore:added', chore);
          return { content: [{ type: 'text', text: `Added chore: ${title}${due_date ? ' due ' + due_date : ''}${repeat_interval ? ', repeats ' + repeat_interval : ''}` }] };
        }
      },
      {
        name: 'complete_chore',
        label: 'Complete Chore',
        description: 'Marks a chore as completed by its ID.',
        parameters: Type.Object({
          id: Type.Number({ description: 'The ID of the chore to complete' }),
        }),
        execute: async (cid, { id }) => {
          const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(id);
          if (!chore) return { content: [{ type: 'text', text: `Chore with ID ${id} not found.` }] };

          // Reuse the logic for repeating chores
          const getNextDueDate = (currentDueDate, interval) => {
            if (!currentDueDate || !interval) return null;
            const date = new Date(currentDueDate);
            if (isNaN(date.getTime())) return null;
            if (interval === 'daily') date.setDate(date.getDate() + 1);
            else if (interval === 'weekly') date.setDate(date.getDate() + 7);
            else if (interval === 'monthly') date.setMonth(date.getMonth() + 1);
            else return null;
            return date.toISOString().split('T')[0];
          };

          if (chore.repeat_interval) {
            const nextDue = getNextDueDate(chore.due_date || new Date().toISOString().split('T')[0], chore.repeat_interval);
            if (nextDue) {
              db.prepare('UPDATE chores SET due_date = ?, done = 0 WHERE id = ?').run(nextDue, id);
              const updated = db.prepare('SELECT * FROM chores WHERE id = ?').get(id);
              io.emit('chore:updated', updated);
              return { content: [{ type: 'text', text: `Completed ${chore.title}. Next occurrence scheduled for ${nextDue}.` }] };
            }
          }

          db.prepare('UPDATE chores SET done = 1 WHERE id = ?').run(id);
          const updated = db.prepare('SELECT * FROM chores WHERE id = ?').get(id);
          io.emit('chore:updated', updated);
          return { content: [{ type: 'text', text: `Completed chore: ${updated.title}` }] };
        }
      },
      {
        name: 'update_chore',
        label: 'Update Chore',
        description: 'Edits an existing chore. Only provide the fields you want to change.',
        parameters: Type.Object({
          id: Type.Number({ description: 'The ID of the chore to update' }),
          title: Type.Optional(Type.String({ description: 'New title/description' })),
          assignee: Type.Optional(Type.String({ description: 'Who is responsible' })),
          priority: Type.Optional(Type.String({ enum: ['low', 'medium', 'high'] })),
          due_date: Type.Optional(Type.String({ description: 'New due date in YYYY-MM-DD format, or null to clear' })),
          repeat_interval: Type.Optional(Type.String({ enum: ['daily', 'weekly', 'monthly'], description: 'Repeat interval, or null to clear' })),
        }),
        execute: async (cid, { id, title, assignee, due_date, priority, repeat_interval }) => {
          const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(id);
          if (!chore) return { content: [{ type: 'text', text: `Chore with ID ${id} not found.` }] };

          const updates = {};
          if (title !== undefined) updates.title = title.trim();
          if (assignee !== undefined) updates.assignee = assignee;
          if (due_date !== undefined) updates.due_date = due_date;
          if (priority !== undefined) updates.priority = priority;
          if (repeat_interval !== undefined) updates.repeat_interval = repeat_interval;

          if (Object.keys(updates).length === 0)
            return { content: [{ type: 'text', text: 'No changes provided.' }] };

          const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
          db.prepare(`UPDATE chores SET ${sets} WHERE id = ?`).run(...Object.values(updates), id);
          const updated = db.prepare('SELECT * FROM chores WHERE id = ?').get(id);
          io.emit('chore:updated', updated);
          return { content: [{ type: 'text', text: `Updated chore ${id}: ${JSON.stringify(updates)}` }] };
        }
      },
      {
        name: 'delete_chore',
        label: 'Delete Chore',
        description: 'Deletes a chore from the system.',
        parameters: Type.Object({
          id: Type.Number({ description: 'The ID of the chore to delete' }),
        }),
        execute: async (cid, { id }) => {
          db.prepare('DELETE FROM chores WHERE id = ?').run(id);
          io.emit('chore:deleted', { id });
          return { content: [{ type: 'text', text: `Deleted chore ${id}.` }] };
        }
      },
      {
        name: 'control_audio',
        label: 'Control Audio',
        description: 'Controls music playback (play, pause, next, prev).',
        parameters: Type.Object({
          command: Type.String({ enum: ['play', 'pause', 'toggle', 'next', 'prev'] }),
        }),
        execute: async (id, { command }) => {
          try {
            // Internal call
            const audioService = await import('./audio.js');
            await audioService.sendCommand(command);
            return { content: [{ type: 'text', text: `Executed audio command: ${command}` }] };
          } catch (e) {
            return { content: [{ type: 'text', text: `Failed to control audio: ${e.message}` }] };
          }
        }
      },
      {
        name: 'get_weather',
        label: 'Get Weather',
        description: 'Returns the current weather conditions.',
        parameters: Type.Object({}),
        execute: async () => {
          try {
            const resp = await fetch(`http://localhost:${OMNI_PORT}/api/weather`);
            const w = await resp.json();
            return { content: [{ type: 'text', text: JSON.stringify(w) }] };
          } catch {
            return { content: [{ type: 'text', text: 'Weather data unavailable.' }] };
          }
        }
      },
      {
        name: 'get_calendar',
        label: 'Get Calendar',
        description: 'Returns the upcoming calendar events.',
        parameters: Type.Object({}),
        execute: async () => {
          const events = db.prepare('SELECT * FROM events WHERE end >= ? ORDER BY start ASC LIMIT 10').all(new Date().toISOString());
          return { content: [{ type: 'text', text: JSON.stringify(events) }] };
        }
      }
    ];

    const loader = new DefaultResourceLoader({
      systemPromptOverride: () => {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `You are "Omni", a voice assistant on a Raspberry Pi home hub.
Current date/time: ${dateStr}, ${timeStr}.

TOOLS:
- add_chore / get_chores / complete_chore / update_chore / delete_chore — the family task list
- get_calendar — READ-ONLY calendar; you CANNOT add or edit calendar events
- get_weather — current weather
- control_audio — play/pause/next/prev music

RULES:
- For any reminder, todo, call, appointment, or thing to remember → ALWAYS use add_chore (due_date if mentioned). Never suggest checking the calendar for these.
- Calendar is read-only. Never try to add events to it.
- Keep replies short — they are spoken aloud. No lists, no markdown.
- Respond in the same language the user used.
- This is a multi-turn conversation. You have full context of prior turns.`;
      }
    });
    await loader.reload();

    const kimiModel   = modelRegistry.find('openrouter', 'moonshotai/kimi-k2');
    const sonnetModel = modelRegistry.find('openrouter', 'anthropic/claude-sonnet-4-5');

    // General session (kimi-k2.5)
    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      customTools: omniTools,
      tools: [],
      ...(kimiModel ? { model: kimiModel } : {}),
    });
    session = result.session;

    // Complex session (claude-sonnet) — same tools, different model
    if (sonnetModel) {
      const complexResult = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        authStorage,
        modelRegistry,
        resourceLoader: loader,
        customTools: omniTools,
        tools: [],
        model: sonnetModel,
      });
      complexSession = complexResult.session;
    }

    console.log('[Agent] Omni Agent initialized (kimi-k2' + (complexSession ? ' + claude-sonnet' : '') + ').');
  } catch (err) {
    console.error('[Agent] Initialization failed:', err);
  }
}

/**
 * Handle a voice command (HTTP path — returns string).
 */
export async function processVoiceCommand(text) {
  if (!session) return "I'm sorry, my brain isn't fully loaded yet.";

  let reply = '';
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      reply += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(text);
    await session.agent.waitForIdle();
    return reply || "I understood, but I have no verbal response.";
  } catch (err) {
    console.error('[Agent] Error processing command:', err);
    return "I encountered an error while processing your request.";
  } finally {
    unsubscribe();
  }
}

/**
 * Handle a voice command via socket — streams status updates back to the client.
 * @param {string}   text  - User's voice command
 * @param {Function} emit  - (event, data) => void
 */
export async function processVoiceCommandSocket(text, emit, complex = false, onAbortReady = null) {
  const activeSession = (complex && complexSession) ? complexSession : session;
  if (!activeSession) {
    emit('agent:done', { text: "I'm sorry, my brain isn't fully loaded yet." });
    return;
  }

  // Expose abort handle before we await anything
  if (onAbortReady) onAbortReady(() => {
    try { activeSession.agent.abort(); } catch {}
  });

  emit('agent:status', { text: 'Thinking…' });

  let reply = '';
  let toolName = '';
  const unsubscribe = activeSession.subscribe((event) => {
    if (event.type === 'message_update') {
      const ev = event.assistantMessageEvent;
      // Only accumulate actual text — skip thinking/reasoning tokens
      if (ev.type === 'text_delta') {
        reply += ev.delta;
      } else if (ev.type === 'tool_call_start') {
        toolName = ev.toolCallEvent?.name || 'tool';
        emit('agent:status', { text: `Using ${toolName}…` });
      }
      // thinking_delta / reasoning_delta are intentionally ignored
    }
  });

  try {
    await activeSession.prompt(text);
    await activeSession.agent.waitForIdle();
    emit('agent:done', { text: reply || "Done." });
  } catch (err) {
    console.error('[Agent] Error processing command:', err);
    emit('agent:error', { text: "I encountered an error while processing your request." });
  } finally {
    unsubscribe();
  }
}

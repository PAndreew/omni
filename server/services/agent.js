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

let session = null;
const OMNI_PORT = process.env.PORT || 3001;

/**
 * Initialize the Omni coding agent session.
 * We provide it with custom tools to interact with the Omni system.
 */
export async function initAgent(io) {
  try {
    const authStorage = AuthStorage.create();
    const modelRegistry = new ModelRegistry(authStorage);
    
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
        return `
You are the "Omni" voice assistant. You are running on a Raspberry Pi hub.
The current date and time is: ${dateStr}, ${timeStr}.
You help the family manage chores, music, and home automation.
Be concise, friendly, and efficient.
When the user asks to do something, use your tools.
If you don't have a tool for something, explain that you can't do it yet but maybe in the future.
Keep your verbal responses short as they will be spoken aloud via TTS.
IMPORTANT: Always respond in the same language the user spoke in. If they speak Hungarian, reply in Hungarian. If English, reply in English.
`;
      }
    });
    await loader.reload();

    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      customTools: omniTools,
      tools: [], 
    });

    session = result.session;
    console.log('[Agent] Omni Agent initialized.');
  } catch (err) {
    console.error('[Agent] Initialization failed:', err);
  }
}

/**
 * Handle a voice command by sending it to the agent.
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

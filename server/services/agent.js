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
          const chores = db.prepare('SELECT * FROM chores ORDER BY done ASC, created_at DESC').all();
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
        }),
        execute: async (id, { title, assignee = '', priority = 'medium' }) => {
          const result = db.prepare('INSERT INTO chores (title, assignee, priority) VALUES (?, ?, ?)')
                           .run(title, assignee, priority);
          const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(result.lastInsertRowid);
          io.emit('chore:added', chore);
          return { content: [{ type: 'text', text: `Added chore: ${title}` }] };
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
          db.prepare('UPDATE chores SET done = 1 WHERE id = ?').run(id);
          const updated = db.prepare('SELECT * FROM chores WHERE id = ?').get(id);
          if (updated) {
            io.emit('chore:updated', updated);
            return { content: [{ type: 'text', text: `Completed chore: ${updated.title}` }] };
          }
          return { content: [{ type: 'text', text: `Chore with ID ${id} not found.` }] };
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
      systemPromptOverride: () => `
You are the "Omni" voice assistant. You are running on a Raspberry Pi hub.
You help the family manage chores, music, and home automation.
Be concise, friendly, and efficient.
When the user asks to do something, use your tools.
If you don't have a tool for something, explain that you can't do it yet but maybe in the future.
Keep your verbal responses short as they will be spoken aloud via TTS.
`
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

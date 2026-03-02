# OmniWall Voice Assistant Configuration

The OmniWall voice assistant has been upgraded from a simple regex-based command processor to a sophisticated **Agentic AI** using the Pi Coding Agent SDK. This document outlines its architecture, capabilities, and instructions for further extension.

## 1. Architecture

The voice assistant operates through three main layers:

1.  **Client-Side Capture (`client/src/hooks/useVoice.js`)**: Uses the Web Speech API to listen for the "Hey Omni" wake word. Once detected, it captures the subsequent speech and sends it to the server.
2.  **Server-Side Agent (`server/services/agent.js`)**: Initializes a Pi Coding Agent session with specialized "Omni Tools." This agent uses an LLM to interpret user intent and execute functions.
3.  **Real-time Bridge (`server/index.js`)**: Relays the agent's actions (like adding a chore) to all connected clients via Socket.io so the UI updates instantly.

## 2. Integrated Tools

The agent currently has access to the following programmatic tools:

| Tool | Description | Parameters |
| :--- | :--- | :--- |
| `get_chores` | Retrieves all pending and completed chores. | None |
| `add_chore` | Adds a new task to the family list. | `title`, `assignee` (opt), `priority` (opt: low/medium/high) |
| `complete_chore`| Marks a specific chore as done. | `id` |
| `delete_chore` | Removes a chore from the database. | `id` |
| `control_audio` | Controls Spotify/Tidal playback. | `command` (play/pause/next/prev/toggle) |
| `get_weather` | Fetches current weather from OpenWeather. | None |
| `get_calendar` | Lists upcoming events from synced iCals. | None |

## 3. Usage Examples

Because the system uses an LLM, you do not need to use exact phrasing. You can say:

*   *"Hey Omni, what do we have to do today?"* (Agent will call `get_chores` and summarize).
*   *"Hey Omni, I finished the laundry."* (Agent will call `get_chores`, find the ID for laundry, and call `complete_chore`).
*   *"Hey Omni, add a high priority task for Dad to fix the sink."* (Agent will call `add_chore` with `priority: 'high'` and `assignee: 'Dad'`).
*   *"Hey Omni, play the next track."* (Agent will call `control_audio`).

## 4. How to Extend (Adding Smart Home Control)

To add new capabilities (e.g., Philips Hue or Home Assistant integration), follow these steps:

1.  Open `/home/pi/Documents/omni/server/services/agent.js`.
2.  Add a new tool object to the `omniTools` array:

```javascript
{
  name: 'toggle_lights',
  label: 'Toggle Lights',
  description: 'Turns the living room lights on or off.',
  parameters: Type.Object({
    state: Type.String({ enum: ['on', 'off'] })
  }),
  execute: async (cid, { state }) => {
    // Implement your IoT logic here (e.g., fetch to Hue Bridge)
    return { content: [{ type: 'text', text: `Lights turned ${state}.` }] };
  }
}
```

3. Restart the server: `systemctl --user restart omniwall-server.service`.

## 5. Maintenance & Troubleshooting

*   **Logs**: View agent activity and tool calls via `journalctl --user -u omniwall-server.service -f`.
*   **Initialization**: The agent initializes on server start. If it fails, check that the Pi Coding Agent is installed at `/usr/lib/node_modules/@mariozechner/pi-coding-agent`.
*   **Wake Word**: The wake words are defined in `client/src/hooks/useVoice.js`. Current words: *omni, hey omni, okay omni, hi omni*.

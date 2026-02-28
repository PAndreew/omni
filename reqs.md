Project Requirements Document (PRD): 
"OmniWall" Family Hub 1. Project Vision 
OmniWall is a high-end, self-hosted family 
dashboard designed for a Raspberry Pi 
connected to a TV.[1] It follows a Dark 
Minimalist Futurism aesthetic, providing a 
"floating" interface for chores, calendars, 
and weather while simultaneously acting as a 
high-fidelity headless audio receiver for 
Spotify and Tidal.[1] 2. Aesthetic & Design 
Language (The "Social Agency" Style) The UI 
shall strictly adhere to the Premium Tech 
Noir design language: Base Palette: Deep 
Void (#000000).[1][2][3] Using true black 
allows the TV bezel to disappear, making 
content feel integrated into the room's 
environment. Layout Engine: Bento Grid. 
Information is grouped into rounded 
rectangular tiles (border-radius: 28px) with 
thin, subtle borders (1px solid 
#222).[1][2][3]
Typography: Headings: Geometric Sans-Serif 
(e.g., Inter or Archivo) in Semi-Bold 
All-Caps. Body: Lightweight variant with 
increased letter spacing (tracking-wide). 
Focus State (Chromatic Glow): When a widget 
is selected via the TV remote, its border 
transforms into a Chromatic Gradient 
(iridescent transition between Cyan, 
Magenta, and Gold) with a soft outer glow 
(box-shadow).[1][2][3] Iconography: 
High-gloss, 3D-rendered assets 
(Glassmorphism style) to provide depth 
against the flat black background.[1][2][3] 
3. System Architecture 3.1 Headless Audio 
Layer (Background) Spotify: Raspotify 
(librespot) running as a systemd 
service.[1][2][3] Tidal: Tidal Connect 
running via a Docker container.[1] Output: 
Forced HDMI digital audio. Metadata Bridge: 
A background worker polls the Spotify/Tidal 
local APIs to emit current track info via 
WebSockets. 3.2 Management Layer 
(Backend)[1][2][3] Engine: Node.js (Express) 
server.[1][2][3] Database: SQLite for 
storing widget positions, chore lists, and 
shared event data.[1][3] CEC Bridge: A 
libcec listener script that translates TV 
remote hardware signals (Up, Down, Left, 
Right, Select, Play/Pause) into JSON events 
sent to the frontend.[1][2][3] Remote 
Access: Tailscale integration allows the 
http://omniwall.tailscale address to be 
accessible for management from any device 
globally. 3.3 Interactive Layer 
(Frontend)[1][2][3] Framework: 
React.js.[1][4][5] Grid Management: 
react-grid-layout (for dragging/resizing 
tiles in Admin mode).[1][2][3] Spatial 
Navigation: norigin-spatial-navigation (to 
handle D-pad movement between tiles on the 
TV).[1][2][3] Real-time Sync: Socket.io to 
ensure changes made on a phone appear 
instantly on the TV.[1][2][3] 4. Functional 
Requirements 4.1 "The Kiosk" (TV View)[2][3] 
Read-Only/Interactive Mode: Boots into a 
full-screen Chromium environment.[1][2] 
Draggable Disabled: Tiles are locked in 
position.[1] Navigation: Uses the TV 
remote's D-pad to move a focus ring between 
widgets.[1][3] Interaction: Pressing 'OK' on 
the remote can toggle a chore's status or 
expand a weather forecast. 4.2 "The 
Controller" (Mobile View)[2] Edit Mode 
Toggle: A hidden or password-protected 
"Edit" button.[1][3] Draggable Enabled: 
Users can drag-and-drop tiles to rearrange 
the Bento Grid.[1][2][3] Tile Store: A 
"Plus" menu to add new widgets (e.g., "Add 
News Feed," "Add Shopping List").[1][3] Data 
Entry: Virtual keyboard access to type in 
new chores or calendar events.[1] 5. Widget 
Specifications (Plugins) Widget 
Functionality Visual Detail Now Playing 
Displays Album Art, Progress, 
Artist.[1][2][3] 3D "Glass" reflection 
effect under the art. Chore List List of 
family tasks with checkboxes. "Check" 
interaction triggers a subtle chromatic 
pulse.[1] Clock/Date Large, center-aligned 
minimalist time.[1] Monospaced font for a 
"technical" feel. Weather Current conditions 
+ 3-day trend.[1][2][3] 3D rendered animated 
weather icons.[1] Calendar Syncs with 
Google/Apple iCal.[1] Minimal dots 
representing "busy" days. 6. Remote Control 
Mapping (CEC)[1][2] TV Remote Button 
Dashboard Action Arrows (U/D/L/R) Move 
chromatic focus ring between Bento 
tiles.[1][2][3] Enter / OK Execute widget 
primary action (Check chore / Play 
music).[1][2][3] Back / Return Exit widget 
"Detail View" back to main grid. Play / 
Pause Toggle background Spotify/Tidal 
playback.[1] Fast Forward / Rewind Skip or 
restart the current track. 7. Implementation 
Roadmap Phase 1 (Core): Install RPi OS, 
Tailscale, and Raspotify.[1][3] Verify music 
plays through TV via HDMI while the desktop 
is visible. Phase 2 (Visuals): Develop the 
React Bento Grid. Implement "Admin Mode" 
with drag-and-drop persistence in 
SQLite.[1][2] Phase 3 (Bridge): Write the 
CEC-to-Socket.io bridge.[3] Implement 
spatial navigation for the TV 
remote.[4][6][7] Phase 4 (Refinement): Apply 
the Premium Tech Noir CSS layer, including 
chromatic borders and glassmorphism 
effects.[1] Phase 5 (Automation): Set CEC 
timers to turn the TV screen off at night 
and on in the morning. Sources help 
magicui.design ibelick.com medium.com 
github.com npmjs.com theodo.com medium.com 
Google Search Suggestions Display of Search 
Suggestions is required when using Grounding 
with Google Search. Learn more spatial 
navigation libraries for react tv apps 
implementing HDMI-CEC to webapp bridge 
raspberry pi nodejs React bento grid 
dashboard libraries dark minimalist 
aesthetic CSS chromatic gradient border 
focus state react

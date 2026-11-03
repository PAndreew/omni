import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

// Never accept a service name, command or shell string from an HTTP client.
export async function restartSpotifyService({ run = execute } = {}) {
  try {
    await run('systemctl', ['--no-ask-password', 'restart', 'raspotify.service'], { timeout: 15000, maxBuffer: 16384 });
  } catch (error) {
    const denied = /access denied|permission|authentication|authorization|not permitted/i.test(`${error.stderr || ''} ${error.message || ''}`);
    const failure = new Error(denied ? 'Spotify restart permission is not installed. Run the one-time install-spotify-controls.sh setup from SSH, then try again.' : 'Spotify restart was not confirmed. Check raspotify in a Pi terminal before retrying.');
    failure.status = denied ? 503 : 502;
    throw failure;
  }
  try {
    const { stdout } = await run('systemctl', ['is-active', 'raspotify.service'], { timeout: 5000, maxBuffer: 16384 });
    if (stdout.trim() !== 'active') throw new Error('inactive');
  } catch { throw new Error('Spotify client did not become active. Check raspotify in a Pi terminal.'); }
  return { restarted: true, note: 'Spotify client restarted. Devices may take a few seconds to reappear; playback may need Connect or Resume.' };
}

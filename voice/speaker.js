import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const defaultAddress = () => process.env.GIZI_SPEAKER_ADDRESS || '54:15:89:8A:F8:6A';
async function speakerSink(address, run) {
  if (!/^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/.test(address)) throw new Error('Speaker address is not configured correctly.');
  const { stdout } = await run('pactl', ['--format=json', 'list', 'sinks'], { timeout: 5000, maxBuffer: 262144 });
  const prefix = `bluez_output.${address.replaceAll(':', '_').toUpperCase()}.`;
  const sink = JSON.parse(stdout).find(item => item.name.toUpperCase().startsWith(prefix.toUpperCase()));
  if (!sink) throw new Error('Bluetooth speaker is offline. Reconnect it first.');
  return sink;
}
export async function getSpeakerVolume({ address = defaultAddress(), run = execute } = {}) {
  const sink = await speakerSink(address, run);
  const value = Object.values(sink.volume || {})[0]?.value_percent;
  const percent = Number.parseInt(value, 10);
  if (!Number.isFinite(percent)) throw new Error('Speaker volume unavailable.');
  return { percent: Math.max(0, Math.min(100, percent)), muted: Boolean(sink.mute), name: sink.description || 'Bluetooth speaker' };
}
export async function setSpeakerVolume(percent, { address = defaultAddress(), run = execute } = {}) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Choose a volume from 0 to 100.');
  const sink = await speakerSink(address, run);
  await run('pactl', ['set-sink-volume', sink.name, `${percent}%`], { timeout: 5000, maxBuffer: 16384 });
  return getSpeakerVolume({ address, run });
}
export async function reconnectSpeaker({ address = process.env.GIZI_SPEAKER_ADDRESS || '54:15:89:8A:F8:6A', run = execute, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!/^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/.test(address)) throw new Error('Speaker address is not configured correctly.');
  const options = { timeout: 15000, maxBuffer: 16384 };
  try { await run('bluetoothctl', ['disconnect', address], options); } catch { /* Already disconnected is fine. */ }
  await wait(1500);
  await run('bluetoothctl', ['connect', address], options);
  const { stdout } = await run('bluetoothctl', ['info', address], options);
  if (!/Connected:\s+yes/.test(stdout)) throw new Error('Speaker did not reconnect. Check power and Bluetooth range.');
  return { connected: true, name: stdout.match(/Name:\s+(.+)/)?.[1]?.trim() || 'Bluetooth speaker' };
}

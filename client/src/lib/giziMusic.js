export async function musicRequest(endpoint, options = {}, fetchImpl = fetch) {
  let response = await fetchImpl(`/gizi/music/${endpoint}`, options);
  let data = await response.json();
  // Gizi rotates browser sessions on restart. Only retry this explicit auth
  // rejection: it happens before any playback mutation can be executed.
  if (response.status === 403 && data.error === 'Pair Gizi first.') {
    const paired = await fetchImpl('/gizi/session', { method: 'POST', signal: options.signal });
    if (!paired.ok) throw new Error('Could not pair this browser. Open Beezywall on its Tailscale HTTPS address.');
    response = await fetchImpl(`/gizi/music/${endpoint}`, options);
    data = await response.json();
  }
  if (!response.ok) throw new Error(data.error || 'Spotify unavailable.');
  return data;
}

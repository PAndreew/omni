import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';

const exec = promisify(execFile);
const credentials = new Map();
export async function googleAccessToken(project) {
  let credential = credentials.get(project);
  if (!credential || credential.expires < Date.now()) {
    const { stdout } = await exec('/usr/bin/gcloud', ['auth', 'print-access-token', `--project=${project}`, '--quiet'], { timeout: 15000, maxBuffer: 8192 });
    credential = { token: stdout.trim(), expires: Date.now() + 45 * 60 * 1000 };
    credentials.set(project, credential);
  }
  return credential;
}
export async function googleClient({ project, location }) {
  const credential = await googleAccessToken(project);
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: credential.token, expiry_date: credential.expires });
  return new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { authClient } });
}

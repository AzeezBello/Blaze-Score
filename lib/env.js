// Minimal .env loader so `npm start` picks up FOOTBALL_DATA_KEY without extra
// tooling. Real environment variables win over the file. Lines look like
// KEY=value or KEY="value"; # starts a comment.
import { readFileSync } from 'node:fs';

export function loadEnv(file = new URL('../.env', import.meta.url), env = process.env) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return env; }
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (!(m[1] in env)) env[m[1]] = value;
  }
  return env;
}

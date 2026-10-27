import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export default async function setupPer89Playwright() {
  const marker = path.join(process.cwd(), '.local-data/per89-ffmpeg-failed-once');
  await mkdir(path.dirname(marker), { recursive: true });
  await writeFile(marker, 'already-used\n', { mode: 0o600 });
}

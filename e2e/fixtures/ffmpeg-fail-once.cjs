#!/usr/bin/env node
const { existsSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const marker = process.env.FFMPEG_FAIL_ONCE_MARKER;
if (marker && !existsSync(marker)) {
  writeFileSync(marker, 'used\n', { flag: 'wx', mode: 0o600 });
  process.stderr.write('Deterministic QA injection: fail the first preview transcode.\n');
  process.exit(1);
}

const executable = process.env.REAL_FFMPEG_PATH || 'ffmpeg';
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);

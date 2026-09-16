// Combined unit test runner
// Run: node tests/unit.mjs

import { spawnSync } from 'node:child_process';
import * as esbuild from 'esbuild';

console.log('=== Running Sidepanel Boot State Tests ===');
const res1 = spawnSync(process.execPath, ['tests/sidepanel-boot-state.mjs'], { stdio: 'inherit' });
if (res1.status !== 0) process.exit(res1.status || 1);

console.log('\n=== Running Vision Fallback Tests ===');
await esbuild.build({
  entryPoints: ['tests/vision-fallback.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/test-vision-fallback.mjs',
  external: ['playwright-core'],
});
const res2 = spawnSync(process.execPath, ['dist/test-vision-fallback.mjs'], { stdio: 'inherit' });
if (res2.status !== 0) process.exit(res2.status || 1);

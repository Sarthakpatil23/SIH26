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
  external: ['playwright-core', 'sharp', 'onnxruntime-web'],
});
const res2 = spawnSync(process.execPath, ['dist/test-vision-fallback.mjs'], { stdio: 'inherit' });
if (res2.status !== 0) process.exit(res2.status || 1);

console.log('\n=== Running Privacy Filter & Redaction Tests ===');
await esbuild.build({
  entryPoints: ['tests/privacy-filter.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/test-privacy-filter.mjs',
  external: ['playwright-core', 'sharp', 'onnxruntime-web'],
});
const res3 = spawnSync(process.execPath, ['dist/test-privacy-filter.mjs'], { stdio: 'inherit' });
if (res3.status !== 0) process.exit(res3.status || 1);

console.log('\n=== Running ONNX Vision Model & UI Detector Tests ===');
await esbuild.build({
  entryPoints: ['tests/onnx-vision.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/test-onnx-vision.mjs',
  external: ['playwright-core', 'sharp', 'onnxruntime-web'],
});
const res4 = spawnSync(process.execPath, ['dist/test-onnx-vision.mjs'], { stdio: 'inherit' });
if (res4.status !== 0) process.exit(res4.status || 1);

console.log('\n=== Running Privacy Comparison ("What You See" vs "What AI Sees") Tests ===');
await esbuild.build({
  entryPoints: ['tests/privacy-comparison.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/test-privacy-comparison.mjs',
  external: ['playwright-core', 'sharp', 'onnxruntime-web'],
});
const res5 = spawnSync(process.execPath, ['dist/test-privacy-comparison.mjs'], { stdio: 'inherit' });
if (res5.status !== 0) process.exit(res5.status || 1);



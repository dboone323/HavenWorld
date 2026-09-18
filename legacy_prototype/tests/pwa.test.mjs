import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_DIR = path.resolve('src/client');

test('PWA manifest.webmanifest exists and contains all required installability fields', () => {
  const manifestPath = path.join(CLIENT_DIR, 'manifest.webmanifest');
  assert.ok(fs.existsSync(manifestPath), 'manifest.webmanifest must exist');

  const content = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(content);

  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.includes('HavenWorld'));
  assert.equal(typeof manifest.short_name, 'string');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0f172a');
  assert.equal(manifest.background_color, '#0a0f1d');

  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest has icons');
  const icon = manifest.icons[0];
  assert.ok(icon.src && icon.sizes && icon.type);
});

test('PWA Service Worker sw.js exists and implements cache lifecycle handlers', () => {
  const swPath = path.join(CLIENT_DIR, 'sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js must exist');

  const swContent = fs.readFileSync(swPath, 'utf8');
  assert.ok(swContent.includes("addEventListener('install'"), 'has install event');
  assert.ok(swContent.includes("addEventListener('activate'"), 'has activate event');
  assert.ok(swContent.includes("addEventListener('fetch'"), 'has fetch event');
  assert.ok(swContent.includes('CACHE_NAME'), 'defines cache name');
  assert.ok(swContent.includes('/manifest.webmanifest'), 'pre-caches manifest');
});

test('PWA icon.svg is valid scalable vector graphic', () => {
  const iconPath = path.join(CLIENT_DIR, 'icon.svg');
  assert.ok(fs.existsSync(iconPath), 'icon.svg must exist');

  const svgContent = fs.readFileSync(iconPath, 'utf8');
  assert.ok(svgContent.startsWith('<svg') && svgContent.includes('</svg>'));
  assert.ok(svgContent.includes('viewBox="0 0 512 512"'));
});

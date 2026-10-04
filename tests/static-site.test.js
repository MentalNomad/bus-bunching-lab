import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { scenarioUrl } from '../dist/scenario-links.js';

const root = new URL('../dist/', import.meta.url);
const projectBase = 'https://mentalnomad.github.io/bus-bunching-lab/';

async function files(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      result.push(...(await files(new URL(entry.name + '/', directory), relative + '/')));
    else result.push(relative);
  }
  return result;
}

test('static page links, styles and module imports resolve under the GitHub Pages project path', async () => {
  for (const path of await files(root)) {
    const text = await readFile(new URL(path, root), 'utf8');
    const refs = path.endsWith('.html')
      ? [...text.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
      : path.endsWith('.js')
        ? [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
        : [];
    for (const ref of refs) {
      if (/^(?:https?:|data:|mailto:|#)/.test(ref)) continue;
      const resolved = new URL(ref, new URL(path, projectBase));
      assert(resolved.href.startsWith(projectBase), `${path}: ${ref} escapes the project path`);
      const relative = resolved.pathname.slice(new URL(projectBase).pathname.length);
      const local = new URL(relative || 'index.html', root);
      assert((await stat(local)).isFile(), `${path}: missing ${ref}`);
    }
  }
});

test('shared scenario URLs retain the GitHub Pages project prefix', () => {
  assert.equal(
    scenarioUrl(projectBase + '?scenario=balanced#bus-lab-copy-example', 'express'),
    projectBase + '?scenario=express',
  );
});

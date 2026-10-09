'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const backendRoots = ['config', 'controllers', 'database', 'middleware', 'models', 'routes', 'scripts', 'services', 'utils'];
const files = [path.join(root, 'app.js')];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
}

backendRoots.forEach(directory => collect(path.join(root, directory)));
const frontendDirectory = path.join(root, 'frontend', 'js');
const frontendFiles = [];
function collectFrontend(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFrontend(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.js')) frontendFiles.push(fullPath);
  }
}
collectFrontend(frontendDirectory);

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push({ file, output: result.stderr || result.stdout });
}
for (const file of frontendFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
  if (result.status !== 0) failures.push({ file, output: result.stderr || result.stdout });
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${path.relative(root, failure.file)}\n${failure.output}`);
  process.exitCode = 1;
} else {
  console.log(`Syntax checks passed: ${files.length} backend files, ${frontendFiles.length} frontend modules.`);
}

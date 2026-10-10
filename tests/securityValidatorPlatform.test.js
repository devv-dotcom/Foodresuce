'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const validatorDirectory = path.join(__dirname, '..', '.agents', 'skills', 'security-audit');
const validators = [
  {
    name: 'findings',
    script: path.join(validatorDirectory, 'validate-findings.cjs'),
    inputName: 'findings.json',
    failure: 'Failed to read findings JSON: OS no-follow and nonblocking input protection is unavailable',
    success: 'PASS: 0 findings valid',
  },
  {
    name: 'coverage ledger',
    script: path.join(validatorDirectory, 'validate-coverage-ledger.cjs'),
    inputName: 'coverage-ledger.json',
    failure: 'Failed to read coverage ledger: OS no-follow and nonblocking input protection is unavailable',
    success: 'PASS: 0 coverage units valid',
  },
];

const hasSafeInputOpen = [fs.constants.O_NOFOLLOW, fs.constants.O_NONBLOCK]
  .every(flag => Number.isInteger(flag) && flag !== 0);

for (const validator of validators) {
  test(`${validator.name} validator preserves safe input handling on this platform`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'food-rescue-validator-platform-'));
    const inputPath = path.join(directory, validator.inputName);
    try {
      fs.writeFileSync(inputPath, '[]', { flag: 'wx' });
      const result = spawnSync(process.execPath, [validator.script, inputPath], {
        encoding: 'utf8',
        timeout: 5000,
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`;

      assert.equal(result.error, undefined, output);
      if (hasSafeInputOpen) {
        assert.equal(result.status, 0, output);
        assert.match(output, new RegExp(validator.success.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
      } else {
        assert.equal(result.status, 1, output);
        assert.ok(output.includes(validator.failure), output);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

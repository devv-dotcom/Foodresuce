'use strict';

const crypto = require('crypto');

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HANDOFF_CODE_LENGTH = 8;

function createHandoffCode() {
  return Array.from({ length: HANDOFF_CODE_LENGTH }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}

function hashHandoffCode(code) {
  return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

function isValidHandoffCode(code) {
  return new RegExp(`^[${alphabet}]{${HANDOFF_CODE_LENGTH}}$`).test(String(code || '').trim().toUpperCase());
}

module.exports = { HANDOFF_CODE_LENGTH, createHandoffCode, hashHandoffCode, isValidHandoffCode };

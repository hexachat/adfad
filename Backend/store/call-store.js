const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const filePath = path.join(dataDir, 'call-history.json');

function load() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

function save(calls) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(calls, null, 2));
}

function addCall(record) {
  const calls = load();
  const entry = {
    id: uuidv4(),
    created_at: new Date().toISOString(),
    duration: 0,
    status: 'completed',
    call_type: 'audio',
    ...record
  };
  calls.unshift(entry);
  save(calls.slice(0, 200));
  return entry;
}

function getCallsForUser(userId) {
  return load()
    .filter((c) => c.caller_id === userId || c.receiver_id === userId)
    .slice(0, 50);
}

module.exports = { addCall, getCallsForUser };

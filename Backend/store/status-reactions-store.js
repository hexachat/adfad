const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const filePath = path.join(dataDir, 'status-reactions.json');

function load() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function addReaction(statusId, userId, reaction) {
  const data = load();
  if (!data[statusId]) data[statusId] = [];
  const existing = data[statusId].findIndex((r) => r.user_id === userId);
  const entry = {
    id: uuidv4(),
    user_id: userId,
    reaction,
    reacted_at: new Date().toISOString()
  };
  if (existing >= 0) data[statusId][existing] = entry;
  else data[statusId].push(entry);
  save(data);
  return entry;
}

function getReactions(statusId) {
  return load()[statusId] || [];
}

function getReactionsForStatuses(statusIds) {
  const data = load();
  const map = {};
  for (const id of statusIds) {
    map[id] = data[id] || [];
  }
  return map;
}

module.exports = { addReaction, getReactions, getReactionsForStatuses };

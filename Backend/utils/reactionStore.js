const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'reactions.json');

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function save(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getForStatus(statusId) {
  const all = load();
  return all[statusId] || [];
}

function setReaction(statusId, userId, reaction) {
  const all = load();
  if (!all[statusId]) all[statusId] = [];
  const idx = all[statusId].findIndex(r => r.user_id === userId);
  if (idx >= 0) {
    if (all[statusId][idx].reaction === reaction) {
      all[statusId].splice(idx, 1);
      if (!all[statusId].length) delete all[statusId];
    } else {
      all[statusId][idx].reaction = reaction;
    }
  } else {
    all[statusId].push({ user_id: userId, reaction, created_at: new Date().toISOString() });
  }
  save(all);
  return all[statusId] || [];
}

function removeReaction(statusId, userId) {
  const all = load();
  if (!all[statusId]) return [];
  all[statusId] = all[statusId].filter(r => r.user_id !== userId);
  if (!all[statusId].length) delete all[statusId];
  save(all);
  return all[statusId] || [];
}

function deleteForStatus(statusId) {
  const all = load();
  delete all[statusId];
  save(all);
}

module.exports = { getForStatus, setReaction, removeReaction, deleteForStatus, load };

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const filePath = path.join(dataDir, 'otp-store.json');

function load() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(filePath)) return { pendingSignups: {}, passwordResets: {} };
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { pendingSignups: {}, passwordResets: {} };
  }
}

function save(data) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function setPendingSignup(email, payload) {
  const data = load();
  data.pendingSignups[email.toLowerCase()] = payload;
  save(data);
}

function getPendingSignup(email) {
  return load().pendingSignups[email.toLowerCase()] || null;
}

function deletePendingSignup(email) {
  const data = load();
  delete data.pendingSignups[email.toLowerCase()];
  save(data);
}

function setPasswordReset(email, payload) {
  const data = load();
  data.passwordResets[email.toLowerCase()] = payload;
  save(data);
}

function getPasswordReset(email) {
  return load().passwordResets[email.toLowerCase()] || null;
}

function deletePasswordReset(email) {
  const data = load();
  delete data.passwordResets[email.toLowerCase()];
  save(data);
}

module.exports = {
  setPendingSignup,
  getPendingSignup,
  deletePendingSignup,
  setPasswordReset,
  getPasswordReset,
  deletePasswordReset
};

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function loadHttpsOptions() {
  if (process.env.USE_HTTPS !== 'true') return null;
  const keyPath = path.join(__dirname, 'certs', 'key.pem');
  const certPath = path.join(__dirname, 'certs', 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  return null;
}

function createServer(app) {
  const ssl = loadHttpsOptions();
  if (ssl) {
    return { server: https.createServer(ssl, app), protocol: 'https' };
  }
  return { server: http.createServer(app), protocol: 'http' };
}

function createDualServers(app, port) {
  const httpServer = http.createServer(app);
  const ssl = loadHttpsOptions();
  const servers = [{ server: httpServer, protocol: 'http', port }];

  if (ssl) {
    const httpsServer = https.createServer(ssl, app);
    servers.push({ server: httpsServer, protocol: 'https', port: port + 443 });
  }
  return servers;
}

module.exports = { createServer, createDualServers, loadHttpsOptions };

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function loadHttpsOptions() {
  const keyPath = path.join(__dirname, '..', 'certs', 'key.pem');
  const certPath = path.join(__dirname, '..', 'certs', 'cert.pem');
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

function createDualServers(app, httpPort, httpsPort) {
  const httpServer = http.createServer(app);
  const servers = [{ server: httpServer, protocol: 'http', port: httpPort }];
  const ssl = loadHttpsOptions();
  if (ssl) {
    const httpsServer = https.createServer(ssl, app);
    servers.push({ server: httpsServer, protocol: 'https', port: httpsPort || httpPort });
  }
  return servers;
}

module.exports = { createServer, createDualServers, loadHttpsOptions };

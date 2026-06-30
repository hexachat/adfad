const fs = require('fs');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(__dirname, '..', 'certs');

function getLanIps() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    if (lower.includes('virtualbox') || lower.includes('vmware') || lower.includes('hyper-v')) continue;
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal || net.address.startsWith('169.254')) continue;
      if (net.address.startsWith('192.168.56.')) continue;
      candidates.push(net.address);
    }
  }
  return candidates.length ? candidates : ['127.0.0.1'];
}

function getLanIp() {
  const ips = getLanIps();
  return (
    ips.find((ip) => ip.startsWith('192.168.') && !ip.startsWith('192.168.56.')) ||
    ips.find((ip) => ip.startsWith('10.')) ||
    ips[0]
  );
}

function ensureCerts() {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  }

  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  const ips = getLanIps();
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...ips.map((ip) => ({ type: 7, ip }))
  ];

  const pems = selfsigned.generate([{ name: 'commonName', value: 'HexaChat Local' }], {
    days: 825,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames }]
  });

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);

  console.log('Generated HTTPS certificates for:', ['localhost', ...ips].join(', '));
  console.log('On your phone: open the https:// link and tap Advanced → Proceed (once).');

  return { key: pems.private, cert: pems.cert };
}

module.exports = { ensureCerts, getLanIp, getLanIps, CERT_DIR };

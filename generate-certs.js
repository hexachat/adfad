const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

async function main() {
  const certDir = path.join(__dirname, '..', 'certs');
  if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log('Certificates already exist in Backend/certs/');
    return;
  }

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'HexaChat' }], {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '101.101.184.2' }
      ]
    }]
  });

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  console.log('HTTPS certificates created in Backend/certs/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

const CACHE_MS = 55 * 60 * 1000;
let meteredCache = null;
let meteredCacheExpiry = 0;

function meteredDomain() {
  const raw = process.env.METERED_DOMAIN || process.env.METERED_APP_NAME || '';
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function openRelayServers() {
  return {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  };
}

function googleStunServers() {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
}

function meteredStunServer() {
  return { urls: 'stun:stun.relay.metered.ca:80' };
}

function buildRtcConfig(iceServers) {
  const onRailway = !!(process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_ENVIRONMENT);
  const policy = process.env.ICE_TRANSPORT_POLICY || (onRailway ? 'relay' : 'all');
  return {
    iceServers,
    iceCandidatePoolSize: 10,
    iceTransportPolicy: policy,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  };
}

async function fetchMeteredIceServers() {
  const domain = meteredDomain();
  const secretKey = process.env.METERED_SECRET_KEY;
  const turnApiKey = process.env.METERED_TURN_API_KEY;

  if (!domain) return null;

  if (turnApiKey) {
    const res = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(turnApiKey)}`
    );
    if (!res.ok) throw new Error(`Metered credentials HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : data.iceServers || null;
  }

  if (secretKey) {
    const createRes = await fetch(
      `https://${domain}/api/v1/turn/credential?secretKey=${encodeURIComponent(secretKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiryInSeconds: Number(process.env.METERED_EXPIRY_SECONDS) || 86400,
          label: 'hexachat'
        })
      }
    );
    if (!createRes.ok) throw new Error(`Metered create credential HTTP ${createRes.status}`);
    const created = await createRes.json();
    const apiKey = created.apiKey || created.api_key;
    if (!apiKey) throw new Error('Metered response missing apiKey');

    const credRes = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`
    );
    if (!credRes.ok) throw new Error(`Metered ICE list HTTP ${credRes.status}`);
    const iceList = await credRes.json();
    return Array.isArray(iceList) ? iceList : iceList.iceServers || null;
  }

  return null;
}

async function getMeteredIceServersCached() {
  if (meteredCache && Date.now() < meteredCacheExpiry) {
    return meteredCache;
  }
  const servers = await fetchMeteredIceServers();
  if (servers?.length) {
    meteredCache = servers;
    meteredCacheExpiry = Date.now() + CACHE_MS;
  }
  return servers;
}

async function getIceServerConfig() {
  const iceServers = [meteredStunServer(), ...googleStunServers()];

  try {
    const meteredTurn = await getMeteredIceServersCached();
    if (meteredTurn?.length) {
      for (const entry of meteredTurn) {
        iceServers.push(entry);
      }
      return buildRtcConfig(iceServers);
    }
  } catch (err) {
    console.warn('Metered.ca TURN unavailable, using Open Relay fallback:', err.message);
  }

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  } else {
    iceServers.push(openRelayServers());
  }

  return buildRtcConfig(iceServers);
}

function getIceServerConfigSync() {
  const iceServers = [meteredStunServer(), ...googleStunServers(), openRelayServers()];
  return buildRtcConfig(iceServers);
}

module.exports = { getIceServerConfig, getIceServerConfigSync };

const express = require('express');
const supabase = require('../config/supabase');
const { formatUser, USER_PUBLIC_SELECT } = require('../config/user-fields');
const { getCallsForUser } = require('../store/call-store');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

async function loadCallsFromDb(userId) {
  const { data: calls, error } = await supabase
    .from('call_history')
    .select(`
      *,
      caller:users!call_history_caller_id_fkey(${USER_PUBLIC_SELECT}),
      receiver:users!call_history_receiver_id_fkey(${USER_PUBLIC_SELECT})
    `)
    .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return null;
  return (calls || []).map((c) => ({
    ...c,
    caller: formatUser(c.caller),
    receiver: formatUser(c.receiver)
  }));
}

async function loadCallsFromStore(userId) {
  const { data: users } = await supabase.from('users').select(USER_PUBLIC_SELECT);
  const userMap = Object.fromEntries((users || []).map((u) => [u.id, formatUser(u)]));

  return getCallsForUser(userId).map((c) => ({
    ...c,
    caller: userMap[c.caller_id] || null,
    receiver: userMap[c.receiver_id] || null
  }));
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    let calls = await loadCallsFromDb(userId);
    if (calls === null) calls = await loadCallsFromStore(userId);
    res.json({ calls });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load call history' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { receiver_id, call_type, status, duration } = req.body;

    const { data: call, error } = await supabase
      .from('call_history')
      .insert({
        caller_id: req.user.id,
        receiver_id,
        call_type: call_type || 'audio',
        status: status || 'completed',
        duration: duration || 0
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, call });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save call' });
  }
});

module.exports = router;

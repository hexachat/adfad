const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const { data: calls } = await supabase
    .from('call_history')
    .select(`
      *,
      caller:users!call_history_caller_id_fkey(id, name, phone_number, profile_photo),
      receiver:users!call_history_receiver_id_fkey(id, name, phone_number, profile_photo)
    `)
    .or(`caller_id.eq.${req.userId},receiver_id.eq.${req.userId}`)
    .order('started_at', { ascending: false })
    .limit(50);

  res.json({ calls: calls || [] });
});

router.post('/log', authMiddleware, async (req, res) => {
  const { receiver_id, call_type, status, duration } = req.body;

  const { data: call, error } = await supabase
    .from('call_history')
    .insert({
      caller_id: req.userId,
      receiver_id,
      call_type: call_type || 'voice',
      status: status || 'answered',
      duration: duration || 0,
      ended_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ call });
});

router.put('/:callId', authMiddleware, async (req, res) => {
  const { status, duration } = req.body;
  const updates = { ended_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (duration !== undefined) updates.duration = duration;

  await supabase.from('call_history').update(updates).eq('id', req.params.callId);
  res.json({ success: true });
});

module.exports = router;

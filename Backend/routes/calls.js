const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/history', auth, async (req, res) => {
  try {
    const { data: calls } = await supabase
      .from('call_history')
      .select(`
        id, call_type, status, duration, started_at, ended_at,
        caller:users!call_history_caller_id_fkey(id, name, phone_number, profile_photo),
        receiver:users!call_history_receiver_id_fkey(id, name, phone_number, profile_photo)
      `)
      .or(`caller_id.eq.${req.user.id},receiver_id.eq.${req.user.id}`)
      .order('started_at', { ascending: false })
      .limit(50);

    res.json(calls || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/log', auth, async (req, res) => {
  try {
    const { receiver_id, call_type, status, duration = 0 } = req.body;

    const { data: call, error } = await supabase
      .from('call_history')
      .insert({
        caller_id: req.user.id,
        receiver_id,
        call_type,
        status,
        duration,
        ended_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(call);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:callId', auth, async (req, res) => {
  try {
    const { status, duration } = req.body;

    const { data: call } = await supabase
      .from('call_history')
      .update({
        status,
        duration,
        ended_at: new Date().toISOString()
      })
      .eq('id', req.params.callId)
      .select('*')
      .single();

    res.json(call);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

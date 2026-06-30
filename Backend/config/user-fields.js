const USER_PUBLIC_SELECT = 'id, name, phone, avatar_url';
const USER_PRIVATE_SELECT = 'id, name, email, phone, avatar_url, is_verified, created_at';
const USER_AUTH_SELECT = 'id, name, email, phone, avatar_url, password_hash, is_verified, created_at';

function formatUser(row, includeEmail = false) {
  if (!row) return null;
  const user = {
    id: row.id,
    name: row.name,
    phone_number: row.phone || row.phone_number || '',
    profile_photo: row.avatar_url || row.profile_photo || null
  };
  if (includeEmail) {
    user.email = row.email;
    user.is_verified = row.is_verified;
    user.created_at = row.created_at;
  }
  return user;
}

function toDbUser({ name, email, password_hash, phone_number, avatar_url, is_verified }) {
  const row = { name, email: email?.toLowerCase() };
  if (password_hash !== undefined) row.password_hash = password_hash;
  if (phone_number !== undefined) row.phone = phone_number;
  if (avatar_url !== undefined) row.avatar_url = avatar_url;
  if (is_verified !== undefined) row.is_verified = is_verified;
  return row;
}

async function fetchUserById(supabase, id) {
  const { data } = await supabase.from('users').select(USER_PUBLIC_SELECT).eq('id', id).maybeSingle();
  return formatUser(data);
}

module.exports = {
  USER_PUBLIC_SELECT,
  USER_PRIVATE_SELECT,
  USER_AUTH_SELECT,
  formatUser,
  toDbUser,
  fetchUserById
};

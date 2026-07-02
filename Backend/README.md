# HexaChat Backend

Node.js backend for HexaChat - real-time messaging, WebRTC calling, OTP auth.

## Setup

```bash
cd Backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm start
```

## Deploy to Railway

1. Connect your GitHub repo to Railway
2. Set root directory to `Backend`
3. Add environment variables from `.env.example`
4. Railway auto-detects Node.js and runs `npm start`

## API Endpoints

- `POST /api/auth/signup` - Register user
- `POST /api/auth/verify-otp` - Verify email OTP
- `POST /api/auth/login` - Login
- `POST /api/auth/forgot-password` - Send reset OTP
- `POST /api/auth/reset-password` - Reset password
- `GET /api/conversations` - Get chat list
- `GET /api/conversations/:id/messages` - Get messages
- WebSocket via Socket.io for real-time chat & calls

## Database

Run `supabase_schema.sql` in your Supabase SQL Editor before starting.

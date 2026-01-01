# Beatmarker

BeatMarker is an experimental web-based audio analysis tool that detects beats, drops, and musical onsets from audio files and exports them as timeline markers compatible with professional video editing software like DaVinci Resolve and Adobe Premiere Pro. Built for editors, musicians, and content creators who want faster, cleaner rhythm-based editing workflows.

Web: https://beatmarker.emjjkk.tech

API: https://beatmarker.onrender.com

## Getting Started

#### API (requirements: Python 13+, pip)

Create a `server/.env` file with `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY`

```
cd server
python -r requirements.txt
python app.py
```

#### Web Application (requirements: Node 18+)

Create a `client/.env.local` file with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

```
cd client
npm install
npm run dev
```

## License

MIT License - Do whatever you want, just don't be evil

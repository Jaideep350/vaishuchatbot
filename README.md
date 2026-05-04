# Wanderly — Python + HTML/CSS/JS edition

A standalone version of Wanderly built with **Python (Flask)** for the backend and **plain HTML / CSS / vanilla JavaScript** for the frontend. No build step, no Node.js required.

## Features

- AI travel chat (streaming) — powered by Lovable AI Gateway
- Auto-detects places mentioned in chat and pins them on a map
- AI-generated images for each place (cached in the browser)
- Email/password authentication (SQLite)
- Save places to favourites (per user)
- Interactive Leaflet map with popups

## Languages used

| Layer    | Language        |
|----------|-----------------|
| Backend  | Python 3        |
| Frontend | HTML, CSS, JS   |
| Database | SQLite (SQL)    |

## Setup

1. **Install Python 3.9+** — https://python.org
2. Clone/extract this folder, open it in VS Code.
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Set your Lovable AI key (get one from Lovable → Workspace Settings → AI):
   - macOS / Linux:
     ```bash
     export LOVABLE_API_KEY="your-key-here"
     ```
   - Windows (cmd):
     ```cmd
     set LOVABLE_API_KEY=your-key-here
     ```
   - Windows (PowerShell):
     ```powershell
     $env:LOVABLE_API_KEY="your-key-here"
     ```
5. Run:
   ```bash
   python app.py
   ```
6. Open http://localhost:5000

## Project structure

```
wanderly-py/
├── app.py              # Flask backend (routes + AI proxy + DB)
├── requirements.txt    # Python dependencies
├── wanderly.db         # SQLite (auto-created on first run)
├── templates/
│   ├── index.html      # Main page (chat + map)
│   └── auth.html       # Login / signup
└── static/
    ├── style.css       # All styling
    ├── app.js          # Chat, map, favourites logic
    └── auth.js         # Auth form logic
```

## API endpoints

| Method | Path                       | Purpose                       |
|--------|----------------------------|-------------------------------|
| POST   | /api/signup                | Create account                |
| POST   | /api/login                 | Sign in                       |
| POST   | /api/logout                | Sign out                      |
| GET    | /api/me                    | Current user                  |
| POST   | /api/chat                  | Stream AI chat response       |
| POST   | /api/place-image           | Generate image for a place    |
| GET    | /api/favourites            | List user favourites          |
| POST   | /api/favourites            | Add favourite                 |
| DELETE | /api/favourites/<id>       | Remove favourite              |

## Notes for your report

This version uses only the languages you asked for:
- **Python** (Flask web framework, SQLite via `sqlite3`, `requests` for AI calls)
- **HTML5** (templates rendered by Jinja2)
- **CSS3** (custom design system, no Tailwind)
- **Vanilla JavaScript** (ES2020, no frameworks, no bundler)

Third-party CDNs used (no install required):
- **Leaflet** — map rendering
- **Marked.js** — markdown rendering for AI replies

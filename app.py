
"""
Wanderly — AI travel guide (Flask version).

Run:
    pip install -r requirements.txt
    export LOVABLE_API_KEY="your-api-key"   # Windows: set LOVABLE_API_KEY=your-api-key
    python app.py

Then open http://localhost:5000
"""
import os
import json
import sqlite3
import base64
import secrets
from functools import wraps
from dotenv import load_dotenv

load_dotenv()

from flask import (
    Flask, render_template, request, jsonify, session,
    redirect, url_for, Response, stream_with_context, g
)
import requests

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "wanderly.db")
LOVABLE_API_KEY = os.environ.get("LOVABLE_API_KEY", "")
AI_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions"

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")

# ---------- Database ----------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(_):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favourites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        city TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    """)
    con.commit()
    con.close()

# ---------- Auth helpers ----------
def hash_pw(pw: str) -> str:
    # Simple salted hash. For production use bcrypt/argon2.
    import hashlib
    salt = "wanderly-static-salt"
    return hashlib.sha256((salt + pw).encode()).hexdigest()

def login_required(fn):
    @wraps(fn)
    def wrapped(*a, **kw):
        if not session.get("user_id"):
            return jsonify({"error": "Not authenticated"}), 401
        return fn(*a, **kw)
    return wrapped

# ---------- Routes: pages ----------
@app.route("/")
def index():
    return render_template("index.html",
                           logged_in=bool(session.get("user_id")),
                           user_email=session.get("user_email", ""))

@app.route("/auth")
def auth_page():
    return render_template("auth.html")

# ---------- Routes: auth API ----------
@app.post("/api/signup")
def signup():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or len(password) < 6:
        return jsonify({"error": "Email and 6+ char password required"}), 400
    db = get_db()
    try:
        db.execute("INSERT INTO users (email, password) VALUES (?, ?)",
                   (email, hash_pw(password)))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already registered"}), 400
    user = db.execute("SELECT id, email FROM users WHERE email=?", (email,)).fetchone()
    session["user_id"] = user["id"]
    session["user_email"] = user["email"]
    return jsonify({"ok": True, "email": user["email"]})

@app.post("/api/login")
def login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    db = get_db()
    user = db.execute("SELECT id, email, password FROM users WHERE email=?",
                      (email,)).fetchone()
    if not user or user["password"] != hash_pw(password):
        return jsonify({"error": "Invalid credentials"}), 401
    session["user_id"] = user["id"]
    session["user_email"] = user["email"]
    return jsonify({"ok": True, "email": user["email"]})

@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})

@app.get("/api/me")
def me():
    if not session.get("user_id"):
        return jsonify({"logged_in": False})
    return jsonify({"logged_in": True, "email": session.get("user_email")})

# ---------- Routes: favourites ----------
@app.get("/api/favourites")
@login_required
def list_favs():
    db = get_db()
    rows = db.execute(
        "SELECT id, name, city, latitude, longitude FROM favourites WHERE user_id=? ORDER BY created_at DESC",
        (session["user_id"],)
    ).fetchall()
    return jsonify([dict(r) for r in rows])

@app.post("/api/favourites")
@login_required
def add_fav():
    d = request.get_json(force=True)
    db = get_db()
    db.execute(
        "INSERT INTO favourites (user_id, name, city, latitude, longitude) VALUES (?,?,?,?,?)",
        (session["user_id"], d["name"], d.get("city"), float(d["latitude"]), float(d["longitude"]))
    )
    db.commit()
    return jsonify({"ok": True})

@app.delete("/api/favourites/<int:fav_id>")
@login_required
def del_fav(fav_id):
    db = get_db()
    db.execute("DELETE FROM favourites WHERE id=? AND user_id=?",
               (fav_id, session["user_id"]))
    db.commit()
    return jsonify({"ok": True})

# ---------- Routes: AI chat (streaming) ----------
SYSTEM_PROMPT_BASE = (
    "You are Wanderly, a friendly AI travel guide. Be concise, warm, and visual.\n"
    "When you mention a real place, append a structured tag IMMEDIATELY after the name in this format:\n"
    "[[place:Name|City|lat|lng]]\n"
    "Example: 'Visit Fushimi Inari [[place:Fushimi Inari Shrine|Kyoto|34.9671|135.7727]] for the famous torii gates.'\n"
    "Use realistic coordinates. Include 2-6 places per response when relevant. Use markdown formatting."
)

from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY"),
    base_url="https://api.groq.com/openai/v1"
)

@app.post("/api/chat")
def chat():
    data = request.get_json(force=True)
    incoming_messages = data.get("messages", [])
    
    # Prepend the system prompt
    messages = [{"role": "system", "content": SYSTEM_PROMPT_BASE}]
    
    # Map frontend 'ai' role to 'assistant' for the API
    for msg in incoming_messages:
        role = msg.get("role")
        if role == "ai":
            role = "assistant"
        messages.append({"role": role, "content": msg.get("content", "")})

    def generate():
        try:
            stream = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=messages,
                stream=True
            )

            for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'choices':[{'delta':{'content': chunk.choices[0].delta.content}}]})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'choices':[{'delta':{'content': 'Error: '+str(e)}}]})}\n\n"

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream")
# ---------- Routes: place image generation ----------
@app.post("/api/place-image")
def place_image():
    d = request.get_json(force=True)
    name = d.get("name", "")
    if not name:
        return jsonify({"error": "No name provided"}), 400
    
    import urllib.parse
    url = f"https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=original&titles={urllib.parse.quote(name)}"
    headers = {"User-Agent": "WanderlyBot/1.0"}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            data = r.json()
            pages = data.get("query", {}).get("pages", {})
            for page_id, page_data in pages.items():
                if "original" in page_data:
                    return jsonify({"image": page_data["original"]["source"]})
    except Exception as e:
        pass

    return jsonify({"error": "No image returned"}), 500

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)

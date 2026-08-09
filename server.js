const express = require("express");
const Database = require("better-sqlite3");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const PORT = process.env.PORT || 3000;

const GOOGLE_CLIENT_ID =
    process.env.GOOGLE_CLIENT_ID ||
    "535095787211-8dgt2e3bc0jilukuq7k65khjdea8sr6t.apps.googleusercontent.com";

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const db = new Database("gamezone.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

/* =========================
   DATABASE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    picture TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    rating INTEGER NOT NULL,
    review TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    game_title TEXT NOT NULL,
    thumbnail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, game_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

/* =========================
   GOOGLE LOGIN
========================= */

app.post("/api/auth/google", async (req, res) => {
    try {
        const { credential } = req.body;

        if (!credential) {
            return res.status(400).json({
                error: "Google credential missing"
            });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();

        const googleId = payload.sub;
        const name = payload.name || "Google User";
        const email = payload.email;
        const picture = payload.picture || "";

        let user = db.prepare(`
            SELECT *
            FROM users
            WHERE google_id = ?
        `).get(googleId);

        if (!user) {
            const result = db.prepare(`
                INSERT INTO users
                (google_id, name, email, picture)
                VALUES (?, ?, ?, ?)
            `).run(
                googleId,
                name,
                email,
                picture
            );

            user = db.prepare(`
                SELECT *
                FROM users
                WHERE id = ?
            `).get(result.lastInsertRowid);
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                picture: user.picture
            }
        });

    } catch (error) {
        console.error("Google login error:", error);

        res.status(401).json({
            error: "Google authentication failed"
        });
    }
});

/* =========================
   GET GAMES
========================= */

app.get("/api/games", async (req, res) => {
    try {
        const response = await fetch(
            "https://www.freetogame.com/api/games"
        );

        if (!response.ok) {
            throw new Error("FreeToGame API failed");
        }

        const games = await response.json();

        res.json(games);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not load games"
        });
    }
});

/* =========================
   REVIEWS
========================= */

app.get("/api/reviews/:gameId", (req, res) => {
    try {
        const gameId = Number(req.params.gameId);

        const reviews = db.prepare(`
            SELECT
                id,
                game_id,
                user_id,
                username,
                rating,
                review,
                created_at
            FROM reviews
            WHERE game_id = ?
            ORDER BY created_at DESC
        `).all(gameId);

        res.json(reviews);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not load reviews"
        });
    }
});

app.post("/api/reviews", (req, res) => {
    try {
        const {
            user_id,
            game_id,
            rating,
            review
        } = req.body;

        if (!user_id || !game_id || !rating || !review) {
            return res.status(400).json({
                error: "All fields are required"
            });
        }

        const cleanReview = String(review).trim();

        if (cleanReview.length < 2 || cleanReview.length > 500) {
            return res.status(400).json({
                error: "Review must be 2-500 characters"
            });
        }

        const numericRating = Number(rating);

        if (
            !Number.isInteger(numericRating) ||
            numericRating < 1 ||
            numericRating > 5
        ) {
            return res.status(400).json({
                error: "Rating must be between 1 and 5"
            });
        }

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE id = ?
        `).get(user_id);

        if (!user) {
            return res.status(401).json({
                error: "User not found"
            });
        }

        const result = db.prepare(`
            INSERT INTO reviews
            (
                game_id,
                user_id,
                username,
                rating,
                review
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            Number(game_id),
            user.id,
            user.name,
            numericRating,
            cleanReview
        );

        res.json({
            success: true,
            id: result.lastInsertRowid
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not save review"
        });
    }
});

/* =========================
   FAVORITES
========================= */

app.get("/api/favorites/:userId", (req, res) => {
    try {
        const userId = Number(req.params.userId);

        const favorites = db.prepare(`
            SELECT
                id,
                game_id,
                game_title,
                thumbnail,
                created_at
            FROM favorites
            WHERE user_id = ?
            ORDER BY created_at DESC
        `).all(userId);

        res.json(favorites);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not load favorites"
        });
    }
});

app.post("/api/favorites", (req, res) => {
    try {
        const {
            user_id,
            game_id,
            game_title,
            thumbnail
        } = req.body;

        if (!user_id || !game_id || !game_title) {
            return res.status(400).json({
                error: "Missing favorite data"
            });
        }

        const user = db.prepare(`
            SELECT id
            FROM users
            WHERE id = ?
        `).get(user_id);

        if (!user) {
            return res.status(401).json({
                error: "User not found"
            });
        }

        db.prepare(`
            INSERT OR IGNORE INTO favorites
            (
                user_id,
                game_id,
                game_title,
                thumbnail
            )
            VALUES (?, ?, ?, ?)
        `).run(
            user_id,
            game_id,
            String(game_title).slice(0, 200),
            thumbnail || ""
        );

        res.json({
            success: true
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not add favorite"
        });
    }
});

app.delete("/api/favorites/:userId/:gameId", (req, res) => {
    try {
        db.prepare(`
            DELETE FROM favorites
            WHERE user_id = ?
            AND game_id = ?
        `).run(
            Number(req.params.userId),
            Number(req.params.gameId)
        );

        res.json({
            success: true
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Could not remove favorite"
        });
    }
});

/* =========================
   GAMEZONE AI
========================= */

app.post("/api/ai", (req, res) => {
    try {
        const message = String(req.body.message || "")
            .trim()
            .toLowerCase();

        if (!message) {
            return res.json({
                reply: "Tell me what kind of game you're looking for 🎮"
            });
        }

        let reply;

        if (
            message.includes("gta") ||
            message.includes("open world")
        ) {
            reply =
                "🔥 If you like GTA-style open-world games, check out games with exploration, vehicles, missions and multiplayer. Search the GameZone library for Action and Shooter games.";
        }

        else if (
            message.includes("shoot") ||
            message.includes("fps") ||
            message.includes("gun")
        ) {
            reply =
                "🔫 Looking for shooters? Try the Shooter category. You can also search for FPS games and save your favorites with ⭐.";
        }

        else if (
            message.includes("football") ||
            message.includes("soccer") ||
            message.includes("sport")
        ) {
            reply =
                "⚽ Sports fan? Open the Sports category and discover football and other competitive games.";
        }

        else if (
            message.includes("free") ||
            message.includes("best")
        ) {
            reply =
                "🎮 Everything listed in GameZone comes from the free-to-play game database. Try searching by genre and save the games you like ⭐.";
        }

        else if (
            message.includes("favorite") ||
            message.includes("favourite")
        ) {
            reply =
                "⭐ Your favorites are saved to your GameZone account. Sign in with Google and use the heart button on a game.";
        }

        else if (
            message.includes("hello") ||
            message.includes("hi") ||
            message.includes("hey")
        ) {
            reply =
                "Yo! 👋 I'm GameZone AI. Tell me what type of game you're looking for 🎮🔥";
        }

        else {
            reply =
                "🎮 I can help you discover games! Try asking me for a shooter, action game, sports game, open-world game, or free game.";
        }

        res.json({
            reply
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "AI request failed"
        });
    }
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {
    res.json({
        status: "online",
        service: "GameZone",
        version: "2.0"
    });
});

/* =========================
   START
========================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `🎮 GameZone is running on port ${PORT}`
    );
});
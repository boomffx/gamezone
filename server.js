
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

/* =====================================================
   DATABASE
===================================================== */

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
    genre TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, game_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

/* =====================================================
   GOOGLE LOGIN
===================================================== */

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

        if (!payload || !payload.sub || !payload.email) {
            return res.status(401).json({
                error: "Invalid Google account"
            });
        }

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
                (
                    google_id,
                    name,
                    email,
                    picture
                )
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

/* =====================================================
   GET GAMES
===================================================== */

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
        console.error("Games API:", error);

        res.status(500).json({
            error: "Could not load games"
        });
    }
});

/* =====================================================
   REVIEWS
===================================================== */

app.get("/api/reviews/:gameId", (req, res) => {
    try {
        const gameId = Number(req.params.gameId);

        if (!Number.isInteger(gameId)) {
            return res.status(400).json({
                error: "Invalid game ID"
            });
        }

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
        const numericRating = Number(rating);
        const numericGameId = Number(game_id);
        const numericUserId = Number(user_id);

        if (
            cleanReview.length < 2 ||
            cleanReview.length > 500
        ) {
            return res.status(400).json({
                error: "Review must be 2-500 characters"
            });
        }

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
        `).get(numericUserId);

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
            numericGameId,
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

/* =====================================================
   FAVORITES
===================================================== */

app.get("/api/favorites/:userId", (req, res) => {
    try {
        const userId = Number(req.params.userId);

        if (!Number.isInteger(userId)) {
            return res.status(400).json({
                error: "Invalid user ID"
            });
        }

        const favorites = db.prepare(`
            SELECT
                id,
                game_id,
                game_title,
                thumbnail,
                genre,
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
            thumbnail,
            genre
        } = req.body;

        const userId = Number(user_id);
        const gameId = Number(game_id);

        if (
            !userId ||
            !gameId ||
            !game_title
        ) {
            return res.status(400).json({
                error: "Missing favorite data"
            });
        }

        const user = db.prepare(`
            SELECT id
            FROM users
            WHERE id = ?
        `).get(userId);

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
                thumbnail,
                genre
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            userId,
            gameId,
            String(game_title).slice(0, 200),
            thumbnail || "",
            genre || ""
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

app.delete(
    "/api/favorites/:userId/:gameId",
    (req, res) => {

        try {
            const userId =
                Number(req.params.userId);

            const gameId =
                Number(req.params.gameId);

            db.prepare(`
                DELETE FROM favorites
                WHERE user_id = ?
                AND game_id = ?
            `).run(
                userId,
                gameId
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
    }
);

/* =====================================================
   ADVANCED GAME AI
   NO API KEY REQUIRED
===================================================== */

function normalize(text) {
    return String(text || "")
        .toLowerCase()
        .trim();
}

function gameScore(game, query) {
    const q = normalize(query);

    const title = normalize(game.title);
    const genre = normalize(game.genre);
    const platform = normalize(game.platform);
    const description =
        normalize(game.short_description);

    let score = 0;

    if (title.includes(q)) score += 10;
    if (genre.includes(q)) score += 8;
    if (platform.includes(q)) score += 5;
    if (description.includes(q)) score += 3;

    return score;
}

function findSimilarGames(games, target) {
    if (!target) return [];

    const targetGenre =
        normalize(target.genre);

    const targetPlatform =
        normalize(target.platform);

    return games
        .filter(game =>
            game.id !== target.id
        )
        .map(game => {

            let score = 0;

            if (
                normalize(game.genre) ===
                targetGenre
            ) {
                score += 60;
            }

            if (
                normalize(game.platform)
                    .split(",")
                    .some(p =>
                        targetPlatform.includes(
                            p.trim()
                        )
                    )
            ) {
                score += 20;
            }

            if (
                normalize(game.short_description)
                    .includes(targetGenre)
            ) {
                score += 10;
            }

            return {
                game,
                score
            };
        })
        .filter(item => item.score > 0)
        .sort(
            (a, b) =>
                b.score - a.score
        )
        .slice(0, 6)
        .map(item => item.game);
}

/* =====================================================
   AI RECOMMENDATION
===================================================== */

app.post("/api/ai/recommend", async (req, res) => {
    try {
        const {
            query,
            gameId
        } = req.body;

        const response = await fetch(
            "https://www.freetogame.com/api/games"
        );

        if (!response.ok) {
            throw new Error("Game API failed");
        }

        const games = await response.json();

        if (gameId) {
            const target =
                games.find(
                    g => g.id == gameId
                );

            if (target) {
                const similar =
                    findSimilarGames(
                        games,
                        target
                    );

                return res.json({
                    mode: "similar",
                    message:
                        `Because you like ${target.title}, you might also like these 🎯`,
                    games: similar
                });
            }
        }

        const q = normalize(query);

        const results =
            games
                .map(game => ({
                    game,
                    score:
                        gameScore(
                            game,
                            q
                        )
                }))
                .filter(
                    item =>
                        item.score > 0
                )
                .sort(
                    (a, b) =>
                        b.score - a.score
                )
                .slice(0, 8)
                .map(
                    item => item.game
                );

        res.json({
            mode: "search",
            message:
                results.length
                    ? `I found ${results.length} games that match your request 🎮`
                    : "I couldn't find an exact match. Try another genre or game type.",
            games: results
        });

    } catch (error) {
        console.error(
            "AI recommendation error:",
            error
        );

        res.status(500).json({
            error:
                "Recommendation system failed"
        });
    }
});

/* =====================================================
   PC SPEC COMPARISON
===================================================== */

function parseSpecs(text) {
    const value =
        normalize(text);

    const ramMatch =
        value.match(
            /(\d+)\s*gb\s*ram/
        );

    const gpuMatch =
        value.match(
            /(gtx|rtx|rx)\s*\d+\s*\w*/i
        );

    const cpuMatch =
        value.match(
            /(ryzen\s*\d+\s*\w*|i[3579]-?\d+\w*)/i
        );

    return {
        ram:
            ramMatch
                ? Number(ramMatch[1])
                : 8,

        gpu:
            gpuMatch
                ? gpuMatch[0]
                : "Unknown",

        cpu:
            cpuMatch
                ? cpuMatch[0]
                : "Unknown"
    };
}

app.post("/api/ai/compare", (req, res) => {
    try {
        const {
            game,
            pc
        } = req.body;

        if (!game || !pc) {
            return res.status(400).json({
                error:
                    "Game and PC specifications are required"
            });
        }

        const specs =
            parseSpecs(pc);

        const text =
            normalize(game);

        let requiredRam = 8;

        if (
            text.includes("rust") ||
            text.includes("warzone")
        ) {
            requiredRam = 16;
        }

        if (
            text.includes("minecraft")
        ) {
            requiredRam = 8;
        }

        if (
            text.includes("gta") ||
            text.includes("valorant")
        ) {
            requiredRam = 8;
        }

        const ramGood =
            specs.ram >= requiredRam;

        res.json({
            compatible: ramGood,

            score:
                ramGood
                    ? 78
                    : 45,

            requirements: {
                ram:
                    `${requiredRam} GB+ RAM recommended`,
                gpu:
                    "Dedicated GPU recommended",
                cpu:
                    "Modern 4-core CPU recommended"
            },

            yourPC: {
                ram:
                    `${specs.ram} GB`,
                gpu:
                    specs.gpu,
                cpu:
                    specs.cpu
            },

            message:
                ramGood
                    ? "Your PC should be able to handle this game, depending on your GPU and graphics settings. 🎮"
                    : "Your RAM may be limiting performance. Consider lowering graphics settings or upgrading RAM."
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error:
                "PC comparison failed"
        });
    }
});

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/api/health", (req, res) => {
    res.json({
        status: "online",
        service: "GameZone",
        version: "3.0"
    });
});

/* =====================================================
   START SERVER
===================================================== */

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `🎮 GameZone Pro running on port ${PORT}`
        );
    }
);


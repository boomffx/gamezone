const express = require("express");
const Database = require("better-sqlite3");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const PORT = 3000;

const GOOGLE_CLIENT_ID =
    "535095787211-8dgt2e3bc0jilukuq7k65khjdea8sr6t.apps.googleusercontent.com";

const googleClient =
    new OAuth2Client(GOOGLE_CLIENT_ID);

const db =
    new Database("gamezone.db");

app.use(express.json());

app.use(express.static("public"));


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


        const ticket =
            await googleClient.verifyIdToken({

                idToken: credential,

                audience: GOOGLE_CLIENT_ID

            });


        const payload =
            ticket.getPayload();


        const googleId =
            payload.sub;

        const name =
            payload.name || "Google User";

        const email =
            payload.email;

        const picture =
            payload.picture || "";


        let user =
            db.prepare(`
                SELECT *
                FROM users
                WHERE google_id = ?
            `).get(googleId);


        if (!user) {

            const result =
                db.prepare(`
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


            user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE id = ?
                `).get(
                    result.lastInsertRowid
                );

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

        console.error(
            "Google login error:",
            error
        );

        res.status(401).json({

            error:
                "Google authentication failed"

        });

    }

});


/* =========================
   GET GAMES
========================= */

app.get("/api/games", async (req, res) => {

    try {

        const response =
            await fetch(
                "https://www.freetogame.com/api/games"
            );


        if (!response.ok) {

            throw new Error(
                "FreeToGame API failed"
            );

        }


        const games =
            await response.json();


        res.json(games);


    } catch (error) {

        console.error(error);


        res.status(500).json({

            error:
                "Could not load games"

        });

    }

});


/* =========================
   GET REVIEWS
========================= */

app.get(
    "/api/reviews/:gameId",
    (req, res) => {

        try {

            const gameId =
                Number(
                    req.params.gameId
                );


            const reviews =
                db.prepare(`
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

                error:
                    "Could not load reviews"

            });

        }

    }
);


/* =========================
   ADD REVIEW
========================= */

app.post(
    "/api/reviews",
    (req, res) => {

        try {

            const {
                user_id,
                game_id,
                rating,
                review
            } = req.body;


            if (
                !user_id ||
                !game_id ||
                !rating ||
                !review
            ) {

                return res.status(400).json({

                    error:
                        "Login and all fields are required"

                });

            }


            if (
                rating < 1 ||
                rating > 5
            ) {

                return res.status(400).json({

                    error:
                        "Rating must be between 1 and 5"

                });

            }


            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE id = ?
                `).get(user_id);


            if (!user) {

                return res.status(401).json({

                    error:
                        "User not found"

                });

            }


            const result =
                db.prepare(`
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

                    game_id,
                    user.id,
                    user.name,
                    rating,
                    review

                );


            res.json({

                success: true,

                id:
                    result.lastInsertRowid

            });


        } catch (error) {

            console.error(error);


            res.status(500).json({

                error:
                    "Could not save review"

            });

        }

    }
);


/* =========================
   START SERVER
========================= */

app.listen(
    PORT,
    () => {

        console.log(
            `GameZone is running at http://localhost:${PORT}`
        );

    }
);
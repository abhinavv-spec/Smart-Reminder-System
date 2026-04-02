const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const webpush = require('web-push');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Basic CORS (safe for deployment)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// ---------------------------------------------------------
// 1. DATABASE SETUP
// ---------------------------------------------------------
const db = new sqlite3.Database('./school.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        subscription TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ---------------------------------------------------------
// 2. AUTO CLEANUP (24 HOURS)
// ---------------------------------------------------------
function cleanupOldMessages() {
    const sql = `DELETE FROM messages WHERE timestamp < datetime('now', '-1 day')`;
    db.run(sql, [], function(err) {
        if (err) console.error("❌ Cleanup Error:", err.message);
        else if (this.changes > 0) {
            console.log(`🧹 Removed ${this.changes} old messages`);
        }
    });
}

setInterval(cleanupOldMessages, 3600000);

// ---------------------------------------------------------
// 3. VAPID CONFIG
// ---------------------------------------------------------
const publicVapidKey = 'BEn8nItzt0vdwHwkrFEm6cN7uJ1TYhGl7EnhYqKF_Pf38IhSOFwr0DPQiOJMuZaS8pfd4krHuANZjJcbrTMqK78';
const privateVapidKey = 'eKBvrbHYBGFQRu9TZh2AUZyGbQwiUmpdv5t5CViwHvQ';

if (!publicVapidKey || !privateVapidKey) {
    console.error("❌ VAPID keys missing");
}

webpush.setVapidDetails(
    'mailto:test@test.com',
    publicVapidKey,
    privateVapidKey
);

// ---------------------------------------------------------
// 4. REGISTER
// ---------------------------------------------------------
app.post('/api/register', async (req, res) => {
    const { name, email, password, subscription } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(
            "INSERT INTO users (name, email, password, subscription) VALUES (?, ?, ?, ?)",
            [name, email, hashedPassword, JSON.stringify(subscription)],
            function(err) {
                if (err) {
                    console.error(err);
                    return res.status(400).json({ error: "Email already exists" });
                }
                res.status(201).json({ message: "Registered successfully" });
            }
        );
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// ---------------------------------------------------------
// 5. LOGIN
// ---------------------------------------------------------
app.post('/api/login', (req, res) => {
    const { email, password, subscription } = req.body;

    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: "User not found" });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: "Invalid password" });
        }

        if (subscription) {
            db.run(
                "UPDATE users SET subscription = ? WHERE id = ?",
                [JSON.stringify(subscription), user.id]
            );
        }

        res.json({ name: user.name, email: user.email });
    });
});

// ---------------------------------------------------------
// 6. BROADCAST MESSAGE
// ---------------------------------------------------------
app.post('/api/send-nudge', (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: "Message required" });
    }

    if (message.length > 200) {
        return res.status(400).json({ error: "Message too long" });
    }

    const payload = JSON.stringify({
        title: "Smart Reminder",
        body: message,
        url: "/dashboard.html",
        tag: "broadcast"
    });

    db.all("SELECT id, subscription FROM users WHERE subscription IS NOT NULL", [], (err, users) => {

        if (err) {
            return res.status(500).json({ error: "Database error" });
        }

        if (!users.length) {
            return res.status(404).json({ error: "No subscribed users" });
        }

        let successCount = 0;

        const promises = users.map(user => {
            try {
                if (!user.subscription) return Promise.resolve();

                const sub = JSON.parse(user.subscription);

                return webpush.sendNotification(sub, payload)
                    .then(() => {
                        successCount++;
                    })
                    .catch(error => {
                        console.error(`❌ Failed for user ${user.id}`, error);

                        if (error.statusCode === 410 || error.statusCode === 404) {
                            console.log(`🧹 Removing invalid subscription for user ${user.id}`);
                            db.run("UPDATE users SET subscription = NULL WHERE id = ?", [user.id]);
                        }
                    });

            } catch (e) {
                console.error(`⚠️ Invalid subscription format for user ${user.id}`);
                return Promise.resolve();
            }
        });

        Promise.all(promises).then(() => {
            db.run("INSERT INTO messages (content) VALUES (?)", [message]);

            console.log(`✅ Sent to ${successCount}/${users.length}`);

            res.json({
                success: true,
                delivered: successCount,
                total: users.length
            });
        });
    });
});

// ---------------------------------------------------------
// 7. GET MESSAGE HISTORY
// ---------------------------------------------------------
app.get('/api/history', (req, res) => {
    db.all(
        "SELECT * FROM messages ORDER BY timestamp DESC",
        [],
        (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(500).json([]);
            }
            res.json(rows);
        }
    );
});

// ---------------------------------------------------------
// 8. START SERVER (RENDER FIX)
// ---------------------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
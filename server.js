const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();

/* -------------------- APP SETUP -------------------- */
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "sibro_admin_secret_123",
    resave: false,
    saveUninitialized: false,
  })
);

/* Make session available in all EJS files */
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.admin = req.session.admin || null;
  next();
});

/* -------------------- DATABASE -------------------- */
const mysql = require("mysql2");

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

db.connect((err) => {
  if (err) console.log("DB error:", err);
  else console.log("MySQL Connected!");
});


/* -------------------- MIDDLEWARES -------------------- */
function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/admin/login");
  next();
}

function requireUser(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

/* -------------------- LANDING PAGE (ONLY LOGIN OPTIONS) -------------------- */
app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/home");
  if (req.session.admin) return res.redirect("/admin/dashboard");
  res.render("landing", { title: "Welcome", active: "" });
});

/* -------------------- USER AUTH -------------------- */

// USER LOGIN PAGE
app.get("/login", (req, res) => {
  res.render("user_login", { title: "User Login", active: "login", error: null });
});

// USER LOGIN POST (simple demo login - no DB)
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render("user_login", {
      title: "User Login",
      active: "login",
      error: "Please enter email and password",
    });
  }

  // store session
  req.session.user = { email };

  // save login log
  db.query("INSERT INTO login_logs (email, role) VALUES (?, ?)", [email, "user"]);

  res.redirect("/home");
});

// USER LOGOUT
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

/* -------------------- USER PAGES (PROTECTED) -------------------- */

// HOME
app.get("/home", requireUser, (req, res) => {
  res.render("index", { title: "Home", active: "home" });
});

// ANIMALS / ADOPT PAGE
app.get("/animals", requireUser, (req, res) => {
  db.query("SELECT * FROM animals", (err, result) => {
    if (err) {
      console.error("❌ Animals Fetch Error:", err.message);
      return res.send("Something went wrong loading animals.");
    }

    res.render("animals", {
      animals: result,
      title: "Adopt",
      active: "adopt",
    });
  });
});

// /adopt should open same adopt page
app.get("/adopt", requireUser, (req, res) => {
  res.redirect("/animals");
});

// DONATE PAGE
app.get("/donate", requireUser, (req, res) => {
  res.render("donate", { title: "Donate", active: "donate" });
});

// VOLUNTEER PAGE
app.get("/volunteer", requireUser, (req, res) => {
  res.render("volunteer", { title: "Volunteer", active: "volunteer" });
});

// ABOUT PAGE
app.get("/about", requireUser, (req, res) => {
  res.render("about", { title: "About", active: "about" });
});

/* -------------------- ADMIN AUTH -------------------- */

// ADMIN LOGIN PAGE
app.get("/admin/login", (req, res) => {
  res.render("admin_login", { title: "Admin Login", error: null, active: "admin" });
});

// ADMIN LOGIN POST
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM admin_users WHERE username = ? LIMIT 1",
    [username],
    async (err, rows) => {
      if (err) {
        console.error("❌ Admin Login DB Error:", err.message);
        return res.render("admin_login", {
          title: "Admin Login",
          error: "DB error. Try again.",
          active: "admin",
        });
      }

      if (!rows.length) {
        return res.render("admin_login", {
          title: "Admin Login",
          error: "Invalid credentials",
          active: "admin",
        });
      }

      const admin = rows[0];
      const ok = await bcrypt.compare(password, admin.password_hash);

      if (!ok) {
        return res.render("admin_login", {
          title: "Admin Login",
          error: "Invalid credentials",
          active: "admin",
        });
      }

      // store session
      req.session.admin = { id: admin.id, username: admin.username };

      // save login log
      db.query("INSERT INTO login_logs (email, role) VALUES (?, ?)", [
        admin.username,
        "admin",
      ]);

      res.redirect("/admin/dashboard");
    }
  );
});

// ADMIN LOGOUT
app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

/* -------------------- CREATE FIRST ADMIN (USE ONCE THEN DELETE) -------------------- */
app.get("/admin/create-first", async (req, res) => {
  try {
    const username = "admin";
    const password = "admin123";
    const hash = await bcrypt.hash(password, 10);

    db.query(
      "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
      [username, hash],
      (err) => {
        if (err) return res.send("Error: " + err.message);
        res.send("✅ Admin created. Username: admin | Password: admin123 (change it)");
      }
    );
  } catch (e) {
    res.send("Error: " + e.message);
  }
});

/* -------------------- ADMIN PAGES (PROTECTED) -------------------- */

// DASHBOARD
app.get("/admin/dashboard", requireAdmin, (req, res) => {
  res.render("admin_dashboard", { title: "Admin Dashboard", active: "admin" });
});

// ADMIN: ADOPTIONS
app.get("/admin", requireAdmin, (req, res) => {
  db.query("SELECT * FROM adoptions ORDER BY id DESC", (err, result) => {
    if (err) {
      console.error("❌ Admin Adoptions Fetch Error:", err.message);
      return res.send("Something went wrong loading adoptions.");
    }
    res.render("admin", {
      adoptions: result,
      title: "Admin - Adoptions",
      active: "admin",
    });
  });
});

// Approve / Reject adoption
app.post("/admin/adoptions/:id/status", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.query("UPDATE adoptions SET status = ? WHERE id = ?", [status, id], (err) => {
    if (err) {
      console.error("❌ Adoption Status Update Error:", err.message);
      return res.send("Update failed.");
    }
    res.redirect("/admin");
  });
});


// ADMIN: VOLUNTEERS
app.get("/admin-volunteers", requireAdmin, (req, res) => {
  db.query("SELECT * FROM volunteers ORDER BY id DESC", (err, result) => {
    if (err) {
      console.error("❌ Admin Volunteers Fetch Error:", err.message);
      return res.send("Something went wrong loading volunteers.");
    }
    res.render("admin_volunteers", {
      volunteers: result,
      title: "Admin - Volunteers",
      active: "admin",
    });
  });
});

/* -------------------- ADMIN: ANIMALS (LIST + ADD + DELETE + EDIT) -------------------- */

// LIST ANIMALS
app.get("/admin-animals", requireAdmin, (req, res) => {
  db.query("SELECT * FROM animals ORDER BY id DESC", (err, result) => {
    if (err) {
      console.error("❌ Admin Animals Fetch Error:", err.message);
      return res.send("Something went wrong loading animals.");
    }
    res.render("admin_animals", {
      animals: result,
      title: "Admin - Animals",
      active: "admin",
    });
  });
});

// ADD ANIMAL
app.post("/admin-animals/add", requireAdmin, (req, res) => {
  const { name, breed, health, image } = req.body;

  db.query(
    "INSERT INTO animals (name, breed, health, image) VALUES (?, ?, ?, ?)",
    [name, breed, health, image],
    (err) => {
      if (err) {
        console.error("❌ Animal Insert Error:", err.message);
        return res.send("Add animal failed.");
      }
      res.redirect("/admin-animals");
    }
  );
});

// DELETE ANIMAL
app.post("/admin-animals/:id/delete", requireAdmin, (req, res) => {
  db.query("DELETE FROM animals WHERE id = ?", [req.params.id], (err) => {
    if (err) {
      console.error("❌ Animal Delete Error:", err.message);
      return res.send("Delete failed.");
    }
    res.redirect("/admin-animals");
  });
});

// EDIT ANIMAL PAGE
app.get("/admin-animals/:id/edit", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM animals WHERE id = ? LIMIT 1", [id], (err, rows) => {
    if (err) {
      console.error("❌ Animal Fetch Error:", err.message);
      return res.send("Error loading animal.");
    }
    if (!rows.length) return res.send("Animal not found.");
    res.render("admin_animal_edit", {
      title: "Edit Animal",
      animal: rows[0],
      active: "admin",
    });
  });
});

// UPDATE ANIMAL POST
app.post("/admin-animals/:id/edit", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, breed, health, image } = req.body;

  db.query(
    "UPDATE animals SET name = ?, breed = ?, health = ?, image = ? WHERE id = ?",
    [name, breed, health, image, id],
    (err) => {
      if (err) {
        console.error("❌ Animal Update Error:", err.message);
        return res.send("Update failed.");
      }
      res.redirect("/admin-animals");
    }
  );
});

/* -------------------- ADMIN DELETE OPERATIONS -------------------- */

// DELETE volunteer
app.post("/admin-volunteers/:id/delete", requireAdmin, (req, res) => {
  db.query("DELETE FROM volunteers WHERE id = ?", [req.params.id], (err) => {
    if (err) {
      console.error("❌ Volunteer Delete Error:", err.message);
      return res.send("Delete failed.");
    }
    res.redirect("/admin-volunteers");
  });
});


// DELETE adoption request
app.post("/admin/adoptions/:id/delete", requireAdmin, (req, res) => {
  db.query("DELETE FROM adoptions WHERE id = ?", [req.params.id], (err) => {
    if (err) {
      console.error("❌ Adoption Delete Error:", err.message);
      return res.send("Delete failed.");
    }
    res.redirect("/admin");
  });
});

/* -------------------- LOGIN HISTORY (ADMIN) -------------------- */
app.get("/admin-logins", requireAdmin, (req, res) => {
  db.query("SELECT * FROM login_logs ORDER BY login_time DESC", (err, logs) => {
    if (err) {
      console.error("❌ Login Logs Fetch Error:", err.message);
      return res.send("Something went wrong loading login history.");
    }

    res.render("admin_logins", {
      title: "Login History",
      logs,
      active: "admin",
    });
  });
});

/* -------------------- FORM SUBMISSIONS (POST) -------------------- */

// ADOPTION FORM SUBMIT
app.post("/adopt", requireUser, (req, res) => {
  const { user_name, email, phone, animal_id } = req.body;

  db.query(
    "INSERT INTO adoptions (user_name, email, phone, animal_id) VALUES (?, ?, ?, ?)",
    [user_name, email, phone, animal_id],
    (err) => {
      if (err) {
        console.error("❌ Adoption Insert Error:", err.message);
        return res.send("Something went wrong. Please try again.");
      }

      res.send(`
        <html>
          <head>
            <title>Adoption Submitted</title>
            <link rel="stylesheet" href="/css/style.css">
          </head>
          <body style="text-align:center;padding:50px;">
            <h1 style="color:#ff6f9f;">🐶 Adoption Request Submitted!</h1>
            <p>Thank you for showing love to one of our animals 💗</p>
            <a href="/animals" style="
              display:inline-block;
              margin-top:25px;
              padding:14px 22px;
              background:#ff6f9f;
              color:white;
              text-decoration:none;
              border-radius:16px;
              font-weight:800;
            ">Back to Dogs</a>
          </body>
        </html>
      `);
    }
  );
});


// VOLUNTEER FORM SUBMIT
app.post("/volunteer", requireUser, (req, res) => {
  const { full_name, email, phone, availability } = req.body;

  db.query(
    "INSERT INTO volunteers (full_name, email, phone, availability) VALUES (?, ?, ?, ?)",
    [full_name, email, phone, availability || ""],
    (err) => {
      if (err) {
        console.error("❌ Volunteer Insert Error:", err.message);
        return res.send("Something went wrong. Please try again.");
      }

      res.send(`
        <html>
          <head>
            <title>Volunteer Submitted</title>
            <link rel="stylesheet" href="/css/style.css">
          </head>
          <body style="text-align:center;padding:50px;">
            <h1 style="color:#ff6f9f;">🐾 Thanks for volunteering!</h1>
            <p>We received your details. We'll contact you soon 💗</p>
            <a href="/home" style="
              display:inline-block;
              margin-top:25px;
              padding:14px 22px;
              background:#ff6f9f;
              color:white;
              text-decoration:none;
              border-radius:16px;
              font-weight:800;
            ">Back to Home</a>
          </body>
        </html>
      `);
    }
  );
});

/* -------------------- SERVER -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));

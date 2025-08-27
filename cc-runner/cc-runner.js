import express from "express";
import cors from "cors";           // <— add this
// ... other imports

const app = express();

// allow your page origins (add any others you use)
const ALLOW_ORIGINS = [
  "https://polycode.pages.dev",
  "https://edifica-polycode.pages.dev",
  "https://polycode.cc",          // add if you have custom domains
];

app.use(cors({
  origin: (origin, cb) => {
    // allow same-origin / curl / server-to-server (no origin header)
    if (!origin) return cb(null, true);
    cb(null, ALLOW_ORIGINS.includes(origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

app.options("*", cors());          // <— handle preflight for all routes
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_, res) => res.json({ ok: true }));  // optional, helpful

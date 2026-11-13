// Local / Docker API server. On Vercel the same handlers run as functions in /api.
import "dotenv/config";
import express from "express";
import cors from "cors";
import { isAuthorized, unauthorized, health, listConsumers, fetchBill } from "./api.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const allowed = (process.env.FRONTEND_ORIGIN || "http://localhost:8080").split(",").map(x=>x.trim());
app.use(cors({origin:(origin,cb)=>!origin || allowed.includes("*") || allowed.includes(origin) ? cb(null,true) : cb(new Error("Origin not allowed"))}));
app.use(express.json({limit:"32kb"}));

const send = (res, { status, body }) => res.status(status).json(body);
const auth = (req,res,next) => isAuthorized(req.get("x-api-key")) ? next() : send(res, unauthorized);

app.get("/api/health", (req,res) => send(res, health()));
app.get("/api/consumers", auth, (req,res) => send(res, listConsumers()));
app.post("/api/fetch-bill", auth, async (req,res) => send(res, await fetchBill(req.body?.consumerId)));

app.listen(port,()=>console.log(`WBSEDCL tracker API listening on ${port}`));

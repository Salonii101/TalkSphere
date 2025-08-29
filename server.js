// server.js (ES modules)
// Usage: node server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

const wss = new WebSocketServer({ server, path: "/ws" });

// rooms: Map<roomId, Set<ws>>
const rooms = new Map();

function roomIdFromNames(a, b) {
  return [String(a || "").trim().toLowerCase(), String(b || "").trim().toLowerCase()].sort().join("#");
}

function broadcastToRoom(roomId, obj, except = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(obj);
  for (const client of room) {
    if (client !== except && client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

wss.on("connection", (ws, req) => {
  // each client will send a join message with { type: 'join', name, friend }
  ws._meta = { room: null, name: null };

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.warn("invalid JSON", err);
      return;
    }

    // Join: assign to a room
    if (data.type === "join") {
      const { name, friend } = data;
      const rid = roomIdFromNames(name, friend);
      ws._meta.name = name || "Anonymous";
      ws._meta.room = rid;
      if (!rooms.has(rid)) rooms.set(rid, new Set());
      rooms.get(rid).add(ws);

      // notify others in room
      broadcastToRoom(rid, { type: "system", event: "join", user: ws._meta.name }, ws);
      return;
    }

    // require room
    const rid = ws._meta.room;
    if (!rid) {
      // ignore until joined
      return;
    }

    // Relay: typing, recording, chat (text/audio), etc.
    if (data.type === "typing") {
      // { type: 'typing', isTyping: true/false }
      broadcastToRoom(rid, { type: "typing", user: ws._meta.name, isTyping: !!data.isTyping }, ws);
      return;
    }

    if (data.type === "recording") {
      // { type:'recording', recording: true/false }
      broadcastToRoom(rid, { type: "recording", user: ws._meta.name, recording: !!data.recording }, ws);
      return;
    }

    if (data.type === "chat") {
      // text message
      // data: { type: 'chat', sub: 'text', text, ts } OR
      // audio: { type:'chat', sub:'audio', data: <base64 dataURL>, durationSec, ts }
      const now = Date.now();
      const payload = {
        type: "chat",
        sub: data.sub || "text",
        user: ws._meta.name,
        ts: data.ts || now,
        // include fields conditionally:
        ...(data.sub === "text" ? { text: String(data.text || "") } : {}),
        ...(data.sub === "audio" ? { data: data.data, durationSec: data.durationSec } : {}),
      };
      broadcastToRoom(rid, payload, ws);
      // echo back to sender as acknowledgement (optional) — here, server will not echo, client displays its own message locally
      return;
    }

    // unknown type: ignore
  });

  ws.on("close", () => {
    const { room: r, name } = ws._meta || {};
    if (r && rooms.has(r)) {
      rooms.get(r).delete(ws);
      if (rooms.get(r).size === 0) rooms.delete(r);
      else {
        broadcastToRoom(r, { type: "system", event: "leave", user: name || "Someone" }, ws);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

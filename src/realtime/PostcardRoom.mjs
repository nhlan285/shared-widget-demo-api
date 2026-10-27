import { DurableObject } from "cloudflare:workers";
import model from "../models/postcardModel.js";
import service from "../services/postcardService.js";
import validation from "../utils/postcardValidation.js";
import cleanup from "../services/postcardCleanup.js";
import creation from "../models/creationModel.js";

const freshDrawing = () => ({ revision: 0, clearRevision: 0, strokes: [], recentEvents: [], lock: null });
const publicDrawing = ({ recentEvents, lock, ...drawing }) => ({
  ...drawing,
  locked: Boolean(lock), lockExpiresAt: lock ? new Date(lock.expiresAt).toISOString() : null,
});

// One Durable Object per pair orders changes from both artists, across Workers.
export class PostcardRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS used_tickets (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
  }

  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.handleRequest(request); }
      catch (error) { return this.failure(error); }
    });
  }

  failure(error) {
    if (!error.statusCode) console.error("Postcard room request failed:", error.message);
    return Response.json({ message: error.statusCode ? error.message : "Could not process postcard request",
      ...(error.activePostcardId ? {activePostcardId:error.activePostcardId} : {}) }, {
      status: error.statusCode || 500, headers: { "cache-control": "no-store" },
    });
  }

  async checkPair(pairId, userId) {
    const storedPair = await this.ctx.storage.get("pairId");
    if (storedPair && storedPair !== pairId) throw validation.fail("Wrong pair room", 403);
    if (await service.requirePair(this.env, userId) !== pairId) throw validation.fail("Pair is no longer active", 403);
    if (!storedPair) await this.ctx.storage.put("pairId", pairId);
  }

  async drawing(id) {
    const drawing = await this.ctx.storage.get(`drawing:${id}`) || freshDrawing();
    if (drawing.lock && drawing.lock.expiresAt <= Date.now()) {
      drawing.lock = null;
      await this.ctx.storage.put(`drawing:${id}`, drawing);
      this.broadcast({ type: "canvas.unlocked", postcardId: id, revision: drawing.revision });
    }
    return drawing;
  }

  async snapshot(row) {
    if (row.kind === "doodle") return model.view(row);
    const drawing = row.status === "sent" ? JSON.parse(row.drawing_json) : await this.drawing(row.postcard_id);
    return { ...model.view(row), revision: drawing.revision, drawing: publicDrawing(drawing) };
  }

  async schedule() {
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 30000);
  }

  broadcast(event) {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      const client = socket.deserializeAttachment();
      if (!client || client.liveUntil <= Date.now()) {
        try { socket.close(4001, "Authentication expired; reconnect with a new ticket"); } catch { /* closed */ }
        continue;
      }
      try { socket.send(message); } catch { /* Client reconnects and requests a snapshot. */ }
    }
  }

  async handleRequest(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") return this.connect(request, url);
    if (request.method !== "POST") throw validation.fail("Method not allowed", 405);
    const data = await request.json();
    if (url.pathname === "/disconnect") {
      const pair = await this.env.DB.prepare("SELECT status FROM pairs WHERE pair_id = ?").bind(data.pairId).first();
      if (!pair || pair.status !== "archived") throw validation.fail("Pair is still active", 409);
      const storedPair = await this.ctx.storage.get("pairId");
      if (storedPair && storedPair !== data.pairId) throw validation.fail("Wrong room", 403);
      await this.purge(data.pairId);
      return Response.json({ disconnected: true });
    }
    await this.checkPair(data.pairId, data.userId);
    await this.schedule();
    if (url.pathname === "/finalize-doodle") {
      const previous=await creation.request(this.env.DB,data.pairId,data.userId,data.requestKey);
      if(previous){
        if(previous.payload_hash!==data.payloadHash)throw validation.fail("Idempotency key payload mismatch",409);
        return Response.json(model.view(await model.get(this.env.DB,previous.postcard_id)));
      }
      if(!data.imageKey?.startsWith(`postcards/${data.pairId}/doodles/`))throw validation.fail("Invalid upload key");
      const row=await creation.saveDoodle(this.env.DB,data);
      if(!row)throw validation.fail("Pair changed while sending Doodle",409);
      const postcard=model.view(row);
      this.broadcast({type:"doodle.sent",postcard});
      return Response.json(postcard);
    }
    if (url.pathname === "/create") {
      if (data.kind === "shared_canvas") {
        const active = await this.env.DB.prepare("SELECT postcard_id FROM active_shared_canvases WHERE pair_id=?")
          .bind(data.pairId).first();
        if (active) throw Object.assign(validation.fail("An active shared canvas already exists",409),
          {activePostcardId:active.postcard_id});
      }
      const existing = (await model.drafts(this.env.DB, data.pairId)).find((r) => r.sender_id === data.userId);
      if (existing) throw validation.fail("You already have a draft in this pair", 409);
      const row = await model.create(this.env.DB, data.pairId, data.userId, validation.canvas(data.canvas), data.kind);
      if (!row) throw validation.fail("Pair changed while creating the draft", 409);
      const postcard = await this.snapshot(row);
      this.broadcast({ type: "postcard.created", postcard });
      return Response.json(postcard);
    }
    const row = await service.requirePostcard(this.env, data.userId, data.postcardId);
    if (url.pathname === "/get") return Response.json(await this.snapshot(row));
    if (row.sender_id !== data.userId) throw validation.fail("Only the postcard owner can perform this action", 403);
    if (row.status === "sent") {
      if (url.pathname === "/finalize") return Response.json(model.view(row));
      if (url.pathname === "/validate-upload") return Response.json({ alreadySent: true, postcard: model.view(row) });
      throw validation.fail("Sent postcards are immutable", 409);
    }
    const drawing = await this.drawing(row.postcard_id);
    if (url.pathname === "/lock") {
      if (!Number.isInteger(data.revision) || data.revision < 0) throw validation.fail("Integer revision is required");
      if (data.revision !== drawing.revision) {
        throw validation.fail("Sync the latest canvas revision before locking", 409);
      }
      // A retried lock request returns the same lock until it expires.
      if (!drawing.lock) {
        drawing.lock = { lockId: crypto.randomUUID(), expiresAt: Date.now() + 120000 };
        await this.ctx.storage.put(`drawing:${row.postcard_id}`, drawing);
        this.broadcast({ type: "canvas.locked", postcardId: row.postcard_id,
          revision: drawing.revision, expiresAt: new Date(drawing.lock.expiresAt).toISOString() });
      }
      return Response.json({ ...await this.snapshot(row), lockId: drawing.lock.lockId });
    }
    if (url.pathname === "/unlock") {
      if (typeof data.lockId !== "string" || !data.lockId) throw validation.fail("lockId is required");
      if (drawing.lock && drawing.lock.lockId !== data.lockId) throw validation.fail("Lock does not match", 409);
      drawing.lock = null;
      await this.ctx.storage.put(`drawing:${row.postcard_id}`, drawing);
      this.broadcast({ type: "canvas.unlocked", postcardId: row.postcard_id, revision: drawing.revision });
      return Response.json(await this.snapshot(row));
    }
    if (url.pathname === "/validate-upload") {
      if (!drawing.lock || drawing.lock.lockId !== data.lockId || drawing.revision !== data.revision) {
        throw validation.fail("Canvas lock expired or revision changed; lock and export again", 409);
      }
      return Response.json({ revision: drawing.revision });
    }
    if (url.pathname === "/discard") {
      if (row.kind === "shared_canvas" && drawing.strokes.some(s => s.actorId !== data.userId)) {
        throw validation.fail("Cannot discard another artist's strokes; save and close instead", 403);
      }
      if (drawing.lock) throw validation.fail("Unlock the canvas before discarding", 409);
      await this.env.DB.prepare("DELETE FROM postcards WHERE postcard_id = ? AND status = 'draft'").bind(row.postcard_id).run();
      await this.ctx.storage.delete(`drawing:${row.postcard_id}`);
      this.broadcast({ type: "postcard.discarded", postcardId: row.postcard_id });
      return Response.json({ postcardId: row.postcard_id });
    }
    if (url.pathname === "/finalize") {
      if (!drawing.lock || drawing.lock.lockId !== data.lockId || drawing.revision !== data.revision) {
        throw validation.fail("Canvas lock expired or revision changed; lock and export again", 409);
      }
      // Candidate keys are generated by the upload controller, never supplied by clients.
      if (!data.imageKey?.startsWith(`postcards/${data.pairId}/${row.postcard_id}/`)) throw validation.fail("Invalid upload key");
      const finalDrawing = { ...drawing, lock: null };
      const result = await model.finalize(this.env.DB, row.postcard_id, data.userId,
        finalDrawing, data.imageKey, data.contentType, data.title);
      if (!result.meta.changes) throw validation.fail("Pair changed while sending the postcard", 409);
      const sent = model.view(await model.get(this.env.DB, row.postcard_id));
      this.broadcast({ type: "postcard.sent", postcard: sent });
      await this.ctx.storage.delete(`drawing:${row.postcard_id}`);
      return Response.json(sent);
    }
    throw validation.fail("Unknown action", 404);
  }

  async connect(request, url) {
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      throw validation.fail("WebSocket upgrade required", 426);
    }
    const ticket = service.verifyTicket(this.env, url.searchParams.get("ticket"));
    await this.checkPair(ticket.pairId, ticket.sub);
    this.ctx.storage.sql.exec("DELETE FROM used_tickets WHERE expires_at < ?", Date.now());
    if ([...this.ctx.storage.sql.exec("SELECT id FROM used_tickets WHERE id = ?", ticket.jti)].length) {
      throw validation.fail("WebSocket ticket already used", 401);
    }
    const existing = this.ctx.getWebSockets().filter((ws) => ws.deserializeAttachment()?.userId === ticket.sub);
    if (existing.length >= 2) throw validation.fail("At most two realtime connections per user", 429);
    const drafts = await model.drafts(this.env.DB, ticket.pairId);
    const postcards = await Promise.all(drafts.map((row) => this.snapshot(row)));
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId: ticket.sub, pairId: ticket.pairId, liveUntil: ticket.liveUntil,
      windowStart: Date.now(), messages: 0 });
    this.ctx.storage.sql.exec("INSERT INTO used_tickets (id, expires_at) VALUES (?, ?)", ticket.jti, ticket.exp * 1000);
    server.send(JSON.stringify({ type: "room.snapshot", pairId: ticket.pairId, postcards }));
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    return this.ctx.blockConcurrencyWhile(async () => {
      let event;
      try {
        const actor = ws.deserializeAttachment();
        if (!actor || actor.liveUntil <= Date.now()) {
          ws.close(4001, "Authentication expired");
          return;
        }
        await this.checkPair(actor.pairId, actor.userId);
        if (typeof message !== "string" || new TextEncoder().encode(message).length > 16384) {
          throw validation.fail("Use a JSON message of at most 16 KB", 413);
        }
        if (Date.now() - actor.windowStart >= 1000) { actor.windowStart = Date.now(); actor.messages = 0; }
        actor.messages++;
        ws.serializeAttachment(actor);
        if (actor.messages > 60) throw validation.fail("At most 60 messages per second per connection", 429);
        try { event = JSON.parse(message); } catch { throw validation.fail("Invalid JSON"); }
        if (!event || typeof event !== "object" || Array.isArray(event)) throw validation.fail("Expected JSON object");
        if (typeof event.postcardId !== "string" || !/^[0-9a-f-]{36}$/i.test(event.postcardId)) {
          throw validation.fail("Invalid postcardId");
        }
        const row = await model.get(this.env.DB, event.postcardId);
        if (!row || row.pair_id !== actor.pairId || ![row.sender_id, row.recipient_id].includes(actor.userId)) {
          throw validation.fail("Postcard not found", 404);
        }
        if (event.type === "canvas.sync") {
          ws.send(JSON.stringify({ type: "canvas.snapshot", postcard: await this.snapshot(row) }));
          return;
        }
        if (row.status !== "draft") throw validation.fail("Sent postcards are immutable", 409);
        const drawing = await this.drawing(row.postcard_id);
        if (drawing.lock) throw validation.fail("Canvas is locked for sending", 409);
        const result = validation.applyEvent(drawing, event, actor.userId, row.sender_id,
          { ownStrokesOnly: row.kind === "shared_canvas" });
        if (!result.duplicate) {
          // Durable storage commit precedes acknowledgement and broadcast.
          await this.ctx.storage.put(`drawing:${row.postcard_id}`, result.drawing);
          this.broadcast({ type: event.type, postcardId: row.postcard_id, eventId: event.eventId,
            actorId: actor.userId, revision: result.revision, ...result.payload });
        } else {
          ws.send(JSON.stringify({ type: "event.ack", postcardId: row.postcard_id,
            eventId: event.eventId, revision: result.revision, duplicate: true }));
        }
        await this.schedule();
      } catch (error) {
        if (!error.statusCode) console.error("Postcard event failed:", error.message);
        try { ws.send(JSON.stringify({ type: "error", status: error.statusCode || 500,
          eventId: typeof event?.eventId === "string" ? event.eventId : null,
          message: error.statusCode ? error.message : "Could not process drawing event" })); } catch { /* disconnected */ }
        if (error.statusCode === 403) {
          const actor = ws.deserializeAttachment();
          const pair = actor && await model.currentPair(this.env.DB, actor.userId);
          if (!pair || pair.pair_id !== actor.pairId) ws.close(4003, "Pair is no longer active");
        }
      }
    });
  }

  webSocketClose(ws, code) { ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, "Connection closed"); }
  webSocketError(ws) { try { ws.close(1011, "Reconnect and request a snapshot"); } catch { /* closed */ } }

  async purge(pairId) {
    this.broadcast({ type: "pair.disconnected", pairId });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(4003, "Pair disconnected"); } catch { /* closed */ }
    }
    await this.ctx.storage.deleteAll();
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS used_tickets (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
    await this.env.DB.prepare("DELETE FROM postcard_room_cleanup WHERE pair_id = ?").bind(pairId).run();
    try { await cleanup.cleanupPostcardImages(this.env, pairId); }
    catch (error) { console.error("Postcard image cleanup queued for retry:", error.message); }
  }

  async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const pairId = await this.ctx.storage.get("pairId");
      if (!pairId) return;
      const pair = await this.env.DB.prepare("SELECT status FROM pairs WHERE pair_id = ?").bind(pairId).first();
      if (!pair || pair.status !== "active") { await this.purge(pairId); return; }
      for (const ws of this.ctx.getWebSockets()) {
        const actor = ws.deserializeAttachment();
        if (!actor || actor.liveUntil <= Date.now()) {
          try { ws.close(4001, "Authentication expired"); } catch { /* closed */ }
        }
      }
      const drawings = await this.ctx.storage.list({ prefix: "drawing:" });
      let hasLock = false;
      for (const [key] of drawings) {
        const id = key.slice("drawing:".length);
        const row = await model.get(this.env.DB, id);
        if (!row || row.status === "sent") {
          // Recover a send that committed D1 before a room restart.
          if (row) this.broadcast({ type: "postcard.sent", postcard: model.view(row) });
          await this.ctx.storage.delete(key);
        } else if ((await this.drawing(id)).lock) hasLock = true;
      }
      this.ctx.storage.sql.exec("DELETE FROM used_tickets WHERE expires_at < ?", Date.now());
      if (hasLock || this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + 30000);
    });
  }
}

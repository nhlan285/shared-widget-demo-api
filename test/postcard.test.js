const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { createTestServer, imageForm, sqlString } = require("./helpers/testServer");

const server = createTestServer();
const sockets = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const canvas = { width: 1, height: 1, backgroundColor: "#ffffff" };
before(() => server.start(), { timeout: 90000 });
after(async () => {
  for (const socket of sockets) socket.close();
  await server.stop();
});

const createDraft = (user) => server.api("POST", "/postcards/drafts", { token: user.token, json: canvas });
const lock = (user, id, revision) => server.api("POST", `/postcards/${id}/lock`, { token: user.token, json: { revision } });
const send = (user, id, locked, bytes = png) => server.api("POST", `/postcards/${id}/send`, {
  token: user.token,
  form: imageForm({ revision: String(locked.revision), lockId: locked.lockId }, "postcard.png", bytes),
});

async function connect(user) {
  const ticket = await server.api("POST", "/postcards/realtime-ticket", { token: user.token, json: {} });
  assert.equal(ticket.status, 201);
  const socket = new WebSocket(ticket.body.data.websocketUrl);
  sockets.push(socket);
  const queue = [];
  const pending = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const index = pending.findIndex((p) => p.type === message.type);
    if (index >= 0) {
      const [waiter] = pending.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else queue.push(message);
  });
  const next = (type) => {
    const index = queue.findIndex((m) => m.type === type);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { type, resolve };
      waiter.timer = setTimeout(() => {
        pending.splice(pending.indexOf(waiter), 1);
        reject(new Error(`Timed out waiting for ${type}; received ${JSON.stringify(queue)}`));
      }, 10000);
      pending.push(waiter);
    });
  };
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return { socket, next, snapshot: await next("room.snapshot"), ticket: ticket.body.data,
    emit: (event) => socket.send(JSON.stringify(event)) };
}

test("postcards: authentication, active pair, draft limit and owner-only actions", async () => {
  assert.equal((await server.api("POST", "/postcards/drafts", { json: canvas })).status, 401);
  const outsider = await server.createUser();
  assert.equal((await createDraft(outsider)).status, 403);
  const { a, b } = await server.connect();
  const draft = await createDraft(a);
  assert.equal(draft.status, 201);
  const id = draft.body.data.postcardId;
  assert.equal((await createDraft(a)).status, 409);
  assert.equal((await createDraft(b)).status, 201);
  assert.equal((await server.api("GET", "/postcards?status=draft", { token: a.token })).body.data.postcards.length, 2);
  assert.equal((await server.api("GET", `/postcards/${id}`, { token: outsider.token })).status, 403);
  assert.equal((await lock(b, id, 0)).status, 403);
  assert.equal((await server.api("DELETE", `/postcards/${id}`, { token: b.token })).status, 403);
  assert.equal((await server.api("DELETE", `/postcards/${id}`, { token: a.token })).status, 200);
  assert.equal((await createDraft(a)).status, 201);
});

test("shared canvases: creator and partner cannot erase each other or discard shared contributions",async()=>{
  const {a,b}=await server.connect();
  const created=await server.api("POST","/postcards/drafts",{token:a.token,
    json:{...canvas,kind:"shared_canvas"}});
  assert.equal(created.status,201);
  const id=created.body.data.postcardId,aa=await connect(a),bb=await connect(b);
  for(const [client,strokeId,revision] of [[aa,"owned-a",0],[bb,"owned-b",1]]){
    client.emit({type:"stroke.start",postcardId:id,eventId:randomUUID(),baseRevision:revision,
      strokeId,color:"#ff6699",tool:"pen",width:.01,point:{x:.5,y:.5}});
    await aa.next("stroke.start");await bb.next("stroke.start");
  }
  for(const [client,target]of[[aa,"owned-b"],[bb,"owned-a"]]){
    client.emit({type:"stroke.remove",postcardId:id,eventId:randomUUID(),baseRevision:2,strokeId:target});
    assert.equal((await client.next("error")).status,403);
    client.emit({type:"canvas.clear",postcardId:id,eventId:randomUUID(),baseRevision:2});
    assert.equal((await client.next("error")).status,403);
    client.emit({type:"stroke.start",postcardId:id,eventId:randomUUID(),baseRevision:2,
      strokeId:"raw-eraser",tool:"eraser",color:"#000000",width:.01,point:{x:.5,y:.5}});
    assert.equal((await client.next("error")).status,403);
  }
  assert.equal((await server.api("DELETE",`/postcards/${id}`,{token:a.token})).status,403);
  const before=await server.api("GET",`/postcards/${id}`,{token:a.token});
  assert.equal(before.body.data.drawing.strokes.length,2);
  aa.emit({type:"stroke.remove",postcardId:id,eventId:randomUUID(),baseRevision:2,strokeId:"owned-a"});
  await aa.next("stroke.remove");await bb.next("stroke.remove");
  const after=await server.api("GET",`/postcards/${id}`,{token:b.token});
  assert.deepEqual(after.body.data.drawing.strokes.map(s=>s.actorId),[b.userId]);
});

test("postcards: both artists draw, reconnect, lock, upload and privately download one immutable image", async () => {
  const { a, b } = await server.connect();
  const draft = (await createDraft(a)).body.data;
  const id = draft.postcardId;
  const aa = await connect(a);
  const bb = await connect(b);
  assert.equal(bb.snapshot.postcards[0].postcardId, id);
  const eventA = { type: "stroke.start", postcardId: id, eventId: randomUUID(), baseRevision: 0,
    strokeId: "a-stroke", color: "#112233", width: 0.01, point: { x: 0.1, y: 0.2 } };
  aa.emit(eventA);
  assert.equal((await bb.next("stroke.start")).actorId, a.userId);
  await aa.next("stroke.start");
  // Both users can start strokes from the same revision, without losing either.
  bb.emit({ ...eventA, eventId: randomUUID(), strokeId: "b-stroke" });
  assert.equal((await aa.next("stroke.start")).actorId, b.userId);
  await bb.next("stroke.start");
  aa.emit(eventA);
  assert.equal((await aa.next("event.ack")).duplicate, true);
  bb.emit({ type: "stroke.remove", postcardId: id, eventId: randomUUID(), baseRevision: 2, strokeId: "a-stroke" });
  assert.equal((await bb.next("error")).status, 403);
  bb.emit({ type: "canvas.clear", postcardId: id, eventId: randomUUID(), baseRevision: 2 });
  assert.equal((await bb.next("error")).status, 403);
  aa.emit({ type: "stroke.append", postcardId: id, eventId: randomUUID(), baseRevision: 2,
    strokeId: "a-stroke", points: [{ x: 0.5, y: 0.6 }] });
  assert.equal((await bb.next("stroke.append")).revision, 3);
  await aa.next("stroke.append");
  bb.emit({ type: "stroke.end", postcardId: id, eventId: randomUUID(), baseRevision: 2, strokeId: "b-stroke" });
  await aa.next("stroke.end");
  await bb.next("stroke.end");

  const reconnected = await connect(b);
  assert.equal(reconnected.snapshot.postcards[0].drawing.strokes.length, 2);
  assert.equal(reconnected.snapshot.postcards[0].drawing.strokes[0].points.length, 2);
  reconnected.socket.close();
  const locked = await lock(a, id, 4);
  assert.equal(locked.status, 200);
  await bb.next("canvas.locked");
  bb.emit({ type: "canvas.clear", postcardId: id, eventId: randomUUID(), baseRevision: 4 });
  assert.equal((await bb.next("error")).status, 409);
  const [sent, concurrentRetry] = await Promise.all([
    send(a, id, locked.body.data), send(a, id, locked.body.data),
  ]);
  assert.equal(sent.status, 200);
  assert.equal(concurrentRetry.status, 200);
  assert.equal(sent.body.data.imageUrl, concurrentRetry.body.data.imageUrl);
  assert.equal(sent.body.data.recipientId, b.userId);
  assert.equal((await bb.next("postcard.sent")).postcard.status, "sent");
  const received = await fetch(`${server.origin}${sent.body.data.imageUrl}`, { headers: { Authorization: `Bearer ${b.token}` } });
  assert.equal(received.status, 200);
  assert.equal(received.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await received.arrayBuffer()), png);
  const download = await fetch(`${server.origin}${sent.body.data.downloadUrl}`, { headers: { Authorization: `Bearer ${a.token}` } });
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  const imageKey = server.sql(`SELECT image_key FROM postcards WHERE postcard_id = ${sqlString(id)}`)[0].image_key;
  assert.equal((await fetch(`${server.origin}/files/${imageKey}`)).status, 404);
  assert.equal((await fetch(`${server.origin}/files/postcards%2F${imageKey.slice("postcards/".length)}`)).status, 404);
  assert.equal((await fetch(`${server.origin}${sent.body.data.imageUrl}`)).status, 401);
  const outsider = await server.createUser();
  assert.equal((await server.api("GET", `/postcards/${id}/image`, { token: outsider.token })).status, 403);
  const retry = await server.api("POST", `/postcards/${id}/send`, { token: a.token, json: {} });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.postcardId, id);
  assert.equal((await lock(a, id, 4)).status, 409);
  assert.equal(server.sql("SELECT COUNT(*) AS n FROM postcard_image_cleanup")[0].n, 0);
});

test("postcards: failed upload unlocks the canvas; disconnect purges history and closes sockets", async () => {
  const { a, b, pairId } = await server.connect();
  const draft = (await createDraft(a)).body.data;
  const bb = await connect(b);
  const locked = await lock(a, draft.postcardId, 0);
  assert.equal((await send(a, draft.postcardId, locked.body.data, [1, 2, 3])).status, 400);
  assert.equal((await bb.next("canvas.unlocked")).postcardId, draft.postcardId);
  const lockedAgain = await lock(a, draft.postcardId, 0);
  assert.equal((await send(a, draft.postcardId, lockedAgain.body.data)).status, 200);
  const closed = new Promise((resolve) => bb.socket.addEventListener("close", resolve, { once: true }));
  const disconnected = await server.api("POST", "/pairs/current/disconnect", { token: a.token });
  assert.equal(disconnected.status, 200);
  assert.equal((await bb.next("pair.disconnected")).pairId, pairId);
  await closed;
  assert.equal(server.sql(`SELECT COUNT(*) AS n FROM postcards WHERE pair_id = ${sqlString(pairId)}`)[0].n, 0);
  assert.equal((await server.api("GET", `/postcards/${draft.postcardId}`, { token: b.token })).status, 403);
  assert.equal(server.sql(`SELECT COUNT(*) AS n FROM postcard_image_cleanup WHERE pair_id = ${sqlString(pairId)}`)[0].n, 0);
  assert.equal(server.sql(`SELECT COUNT(*) AS n FROM postcard_room_cleanup WHERE pair_id = ${sqlString(pairId)}`)[0].n, 0);
});

test("postcards: websocket tickets are single-use and cannot authenticate REST", async () => {
  const { a } = await server.connect();
  const aa = await connect(a);
  assert.equal((await server.api("GET", "/postcards", { token: aa.ticket.ticket })).status, 403);
  await new Promise((resolve, reject) => {
    const replay = new WebSocket(aa.ticket.websocketUrl);
    const timeout = setTimeout(() => { replay.close(); reject(new Error("Replayed ticket did not fail")); }, 10000);
    replay.addEventListener("open", () => { clearTimeout(timeout); replay.close(); reject(new Error("Ticket was accepted twice")); }, { once: true });
    replay.addEventListener("error", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  const missing = await fetch(`${server.origin}/v1/postcards/realtime`);
  assert.equal(missing.status, 401);
});

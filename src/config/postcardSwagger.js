const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ "application/json": { schema } });
const envelope = (schema) => ({
  type: "object",
  properties: {
    statusCode: { type: "integer" },
    message: { type: "string" },
    data: schema,
    timestamp: { type: "string", format: "date-time" },
  },
});
const response = (description, schema = ref("Postcard")) => ({
  description,
  content: json(envelope(schema)),
});
const id = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 503].map((code) => [
    code,
    {
      description: {
        400: "Invalid input",
        401: "Authentication required",
        403: "Not allowed / no active pair",
        404: "Postcard not found",
        409: "Draft limit, canvas lock or revision conflict",
        413: "Image exceeds 10 MB",
        503: "R2 or realtime binding unavailable",
      }[code],
      content: json(ref("ErrorResponse")),
    },
  ]),
);
const operation = (summary, extra = {}) => ({
  tags: ["Postcards"],
  summary,
  security: [{ bearerAuth: [] }],
  responses: { 200: response("Success"), ...errors },
  ...extra,
});
const request = (schema) => ({ required: true, content: json(schema) });

const schemas = {
  Postcard: {
    type: "object",
    properties: {
      postcardId: { type: "string", format: "uuid" },
      pairId: { type: "string", format: "uuid" },
      senderId: { type: "string", format: "uuid" },
      recipientId: { type: "string", format: "uuid" },
      status: { type: "string", enum: ["draft", "sent"] },
      width: { type: "integer" },
      height: { type: "integer" },
      backgroundColor: { type: "string", example: "#ffffff" },
      revision: {
        type: "integer",
        nullable: true,
        description:
          "Draft lists omit live revisions (null). GET detail or WebSocket snapshot returns the authoritative revision.",
      },
      createdAt: { type: "string", format: "date-time" },
      sentAt: { type: "string", format: "date-time", nullable: true },
      imageUrl: {
        type: "string",
        nullable: true,
        description:
          "Relative authenticated API path. Prefix the API origin; send Bearer token.",
      },
      downloadUrl: { type: "string", nullable: true },
      drawing: ref("PostcardDrawing"),
      lockId: {
        type: "string",
        description:
          "Only returned to owner by lock endpoint; expires after 120 seconds.",
      },
    },
  },
  PostcardCanvas: {
    type: "object",
    required: ["width", "height", "backgroundColor"],
    properties: {
      width: { type: "integer", minimum: 1, maximum: 4096, example: 1080 },
      height: { type: "integer", minimum: 1, maximum: 4096, example: 1440 },
      backgroundColor: {
        type: "string",
        pattern: "^#[0-9a-fA-F]{6}$",
        example: "#ffffff",
      },
    },
  },
  PostcardDrawing: {
    type: "object",
    properties: {
      revision: { type: "integer" },
      clearRevision: { type: "integer" },
      locked: { type: "boolean" },
      lockExpiresAt: { type: "string", format: "date-time", nullable: true },
      strokes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            strokeId: { type: "string" },
            actorId: { type: "string" },
            tool: { type: "string", enum: ["pen", "eraser"] },
            color: { type: "string" },
            width: {
              type: "number",
              description: "Normalized against canvas width",
            },
            ended: { type: "boolean" },
            points: { type: "array", items: ref("PostcardPoint") },
          },
        },
      },
    },
  },
  PostcardPoint: {
    type: "object",
    required: ["x", "y"],
    properties: {
      x: { type: "number", minimum: 0, maximum: 1 },
      y: { type: "number", minimum: 0, maximum: 1 },
    },
  },
  PostcardTicket: {
    type: "object",
    properties: {
      ticket: { type: "string" },
      expiresIn: { type: "integer", example: 60 },
      liveUntil: { type: "string", format: "date-time" },
      websocketUrl: { type: "string" },
    },
  },
};

const paths = {
  "/postcards/drafts": {
    post: operation("Create your one shared draft in the current pair", {
      description:
        "Both pair members may draw. Each member owns at most one draft. See POSTCARD_REALTIME.md for the WebSocket protocol.",
      requestBody: request(ref("PostcardCanvas")),
      responses: { 201: response("Draft created"), ...errors },
    }),
  },
  "/postcards": {
    get: operation("List current pair postcards", {
      parameters: [
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["draft", "sent"], default: "sent" },
        },
        {
          name: "page",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
      ],
      responses: {
        200: response("Postcards", {
          type: "object",
          properties: {
            postcards: { type: "array", items: ref("Postcard") },
            page: { type: "integer" },
            limit: { type: "integer" },
          },
        }),
        ...errors,
      },
    }),
  },
  "/postcards/{id}": {
    get: operation("Get a postcard with its authoritative drawing snapshot", {
      parameters: [id],
    }),
    delete: operation("Owner discards an unlocked draft", {
      parameters: [id],
      responses: {
        200: response("Draft discarded", {
          type: "object",
          properties: { postcardId: { type: "string" } },
        }),
        ...errors,
      },
    }),
  },
  "/postcards/realtime-ticket": {
    post: operation("Create a single-use WebSocket ticket", {
      description:
        "Connect to websocketUrl within 60 seconds. Connection expires at liveUntil (maximum one hour). Never use an access JWT in the URL.",
      responses: {
        201: response("Ticket created", ref("PostcardTicket")),
        ...errors,
      },
    }),
  },
  "/postcards/realtime": {
    get: {
      tags: ["Postcards"],
      summary: "WebSocket connection (use a WebSocket client)",
      description:
        "Upgrade connection using the ticket. See POSTCARD_REALTIME.md for events, snapshots, ordering and reconnect.",
      parameters: [
        {
          name: "ticket",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        101: { description: "WebSocket connected" },
        401: { description: "Invalid, used or expired ticket" },
        426: { description: "Requires WebSocket upgrade" },
        429: { description: "Too many connections" },
      },
    },
  },
  "/postcards/{id}/lock": {
    post: operation("Owner freezes both artists before exporting the image", {
      parameters: [id],
      requestBody: request({
        type: "object",
        required: ["revision"],
        properties: { revision: { type: "integer", minimum: 0 } },
      }),
    }),
  },
  "/postcards/{id}/unlock": {
    post: operation("Owner cancels a send lock", {
      parameters: [id],
      requestBody: request({
        type: "object",
        required: ["lockId"],
        properties: { lockId: { type: "string" } },
      }),
    }),
  },
  "/postcards/{id}/send": {
    post: operation(
      "Owner uploads the locked canvas as a PNG/JPEG and sends it",
      {
        parameters: [id],
        description:
          "Lock first, render the returned snapshot, then upload. Sent postcard retries return the existing result without replacing its image. Upload failure releases a matching lock; otherwise it expires in 120 seconds.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file", "revision", "lockId"],
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description:
                      "PNG or JPEG, maximum 10 MB, same dimensions as the canvas",
                  },
                  revision: { type: "integer", minimum: 0 },
                  lockId: { type: "string" },
                },
              },
            },
          },
        },
      },
    ),
  },
  "/postcards/{id}/image": {
    get: operation("View or download a private postcard image", {
      parameters: [
        id,
        {
          name: "download",
          in: "query",
          schema: { type: "string", enum: ["1"] },
          description: "1 adds Content-Disposition: attachment",
        },
      ],
      responses: {
        200: {
          description:
            "Private image bytes (no JSON envelope). App may save/share the file.",
          content: {
            "image/png": { schema: { type: "string", format: "binary" } },
            "image/jpeg": { schema: { type: "string", format: "binary" } },
          },
        },
        ...errors,
      },
    }),
  },
};

// Demo creation extension: retain every legacy endpoint and auth schema.
Object.assign(schemas.Postcard.properties, {
  kind: { type: "string", enum: ["doodle", "shared_canvas"] },
  title: { type: "string", maxLength: 160 },
  source: { type: "string", enum: ["camera", "blank"], nullable: true },
  expiresAt: { type: "string", format: "date-time", nullable: true },
  closedAt: { type: "string", format: "date-time", nullable: true },
});
schemas.Postcard.properties.status.enum.push("saved");
schemas.Postcard.required = [
  "postcardId",
  "pairId",
  "senderId",
  "recipientId",
  "status",
  "width",
  "height",
  "createdAt",
];
schemas.PostcardCanvas.properties.kind = {
  type: "string",
  enum: ["shared_canvas"],
  description: "Required for new shared flow; omitted means legacy owner draft",
};
paths["/postcards/drafts"].post.description =
  "kind=shared_canvas creates at most one active canvas per PAIR atomically. A racing caller receives409 with data.activePostcardId and joins it. Legacy request without kind retains per-owner limit.";
paths["/postcards"].get.parameters[0].schema.enum.push("saved");
paths["/postcards"].get.parameters.push(
  {
    name: "kind",
    in: "query",
    schema: { type: "string", enum: ["doodle", "shared_canvas"] },
  },
  {
    name: "from",
    in: "query",
    schema: { type: "string", format: "date-time" },
    description: "Inclusive RFC3339 timestamp with timezone",
  },
  {
    name: "to",
    in: "query",
    schema: { type: "string", format: "date-time" },
    description: "Exclusive RFC3339 timestamp with timezone",
  },
  {
    name: "senderId",
    in: "query",
    schema: { type: "string" },
    description: "CSV of up to two UUID user IDs; OR semantics",
  },
  {
    name: "q",
    in: "query",
    schema: { type: "string", maxLength: 160 },
    description: "Case-insensitive literal title substring; before pagination",
  },
);
paths["/postcards"].get.responses[200].content[
  "application/json"
].schema.properties.data.properties.hasMore = { type: "boolean" };
paths["/postcards/capabilities"] = {
  get: operation("Creation contract capabilities", {
    responses: {
      200: response("Capabilities", {
        type: "object",
        required: [
          "contractVersion",
          "privateDoodles",
          "singleActiveCanvas",
          "canvasArchive",
        ],
        properties: {
          contractVersion: { type: "integer", enum: [2] },
          privateDoodles: { type: "boolean" },
          singleActiveCanvas: { type: "boolean" },
          canvasArchive: { type: "boolean" },
        },
      }),
      ...errors,
    },
  }),
};
paths["/postcards/active-canvas"] = {
  get: operation("Authoritative single active shared canvas", {
    responses: {
      200: response("Current canvas or null", {
        allOf: [ref("Postcard")],
        nullable: true,
      }),
      ...errors,
    },
  }),
};
paths["/postcards/widget-state"] = {
  get: operation("Latest unexpired Doodle and latest saved shared canvas", {
    responses: {
      200: response("Widget metadata", {
        type: "object",
        properties: {
          doodle: { allOf: [ref("Postcard")], nullable: true },
          canvas: { allOf: [ref("Postcard")], nullable: true },
          now: { type: "string", format: "date-time" },
        },
      }),
      ...errors,
    },
  }),
};
paths["/postcards/doodles"] = {
  post: operation("Send a privately composed camera/blank Doodle", {
    parameters: [
      {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    description:
      "PNG/JPEG max10MB, dimensions1..4096. No shared draft or live stroke exposure. expiresAt=sentAt+24h. Same key/payload returns original; different payload409.",
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["file", "source"],
            properties: {
              file: { type: "string", format: "binary" },
              source: { type: "string", enum: ["camera", "blank"] },
              caption: { type: "string", maxLength: 160 },
            },
          },
        },
      },
    },
    responses: {
      200: response("Idempotent retry"),
      201: response("Sent"),
      ...errors,
    },
  }),
};
paths["/postcards/{id}/close"] = {
  post: operation("Owner names, saves and closes a shared canvas", {
    parameters: [id],
    description:
      "Lock first; export returned canonical snapshot at its exact dimensions. Owner only, saved immutable result on retries. Releases active slot.",
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["file", "title", "revision", "lockId"],
            properties: {
              file: { type: "string", format: "binary" },
              title: { type: "string", minLength: 1, maxLength: 80 },
              revision: { type: "integer", minimum: 0 },
              lockId: { type: "string" },
            },
          },
        },
      },
    },
  }),
};
paths["/postcards/{id}/send"].post.deprecated = true;
schemas.Postcard.properties.expiresAt.description =
  "Doodle widget deadline only (sentAt+24h). Authenticated library image remains available while the pair is active.";
paths["/postcards/{id}/image"].get.description =
  "Private image for active pair members, including Doodles past their widget deadline. No public R2 URL; private,no-store. Pair revocation still denies access.";
schemas.PostcardDrawing.properties.strokes.items.properties.tool.description =
  "Historical eraser masks only its own actor's earlier ink. New shared canvases accept pen only; erasing sends own stroke.remove IDs.";
paths["/postcards/{id}"].delete.description =
  "Owner only, unlocked draft. Shared canvas with another artist's strokes returns403; save/close instead. No participant can discard the other's ink.";
module.exports = { schemas, paths };

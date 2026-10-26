const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const { publicOrigin } = require("./utils/sendResponse");

/**
 * Tạo Express app
 * @param {Object} options
 * @param {Object} options.specs - OpenAPI document
 * @param {Function} options.docsPage - Handler trả về trang Swagger UI
 * @return {Object} - Express app
 */
const createApp = ({ specs, docsPage }) => {
  const app = express();

  // Allow all origins: the API uses Bearer tokens, not cookies
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "Accept",
        "Origin",
        "X-Requested-With",
      ],
      optionsSuccessStatus: 200,
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  // Multipart stays a raw Buffer for parseMultipartForm. Above the 10MB file
  // limit so controllers can answer with their own validation message.
  app.use(express.raw({ type: "multipart/form-data", limit: "20mb" }));

  app.get("/api-docs", docsPage);

  // Swagger JSON endpoint
  app.get("/api-docs.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(specs);
  });

  app.get("/openapi.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=shared-widget-api.json"
    );
    res.send(specs);
  });

  // Export endpoint for Postman Collection
  app.get("/postman-collection", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=shared-widget-postman-collection.json"
    );

    // Convert OpenAPI to basic Postman collection format
    const collection = {
      info: {
        name: "Shared Widget API",
        description: "API collection generated from OpenAPI specification",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [
        {
          key: "baseUrl",
          value: publicOrigin(req),
          type: "string",
        },
      ],
      auth: {
        type: "bearer",
        bearer: [
          {
            key: "token",
            value: "{{authToken}}",
            type: "string",
          },
        ],
      },
    };

    res.send(collection);
  });

  // Root endpoint with API information
  app.get("/", (req, res) => {
    res.json({
      message: "Welcome to Shared Widget API",
      version: "1.0.0",
      documentation: {
        swagger: "/api-docs",
        json: "/api-docs.json",
      },
      endpoints: {
        authentication: "/v1/auth-service",
        users: "/v1/user-service",
        scanning: "/v1/scan-service",
      },
    });
  });

  routes(app);

  return app;
};

module.exports = { createApp };

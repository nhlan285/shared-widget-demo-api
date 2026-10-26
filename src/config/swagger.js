// Built ahead of time by scripts/build-openapi.js: swagger-jsdoc reads the
// route files from disk, which a Worker cannot do at runtime.
const path = require("path");
const swaggerJSDoc = require("swagger-jsdoc");
const { BASE_URL } = require("../utils/constant");

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Shared Widget API",
      version: "1.0.0",
      description: `
# Shared Widget API

Backend chạy trên **Cloudflare Workers**, dữ liệu lưu trong **D1** (SQLite) và file ảnh trong **R2**.

## 🚀 **Quick Start**
1. **Register** a new account, a 6-digit code is emailed to you
2. **Verify email** with that code (also logs you in), or **Login** later to get JWT tokens
3. Bấm **Authorize** và dán access token
4. Gọi các API User / Scan

## 🔐 **Authentication**
- Use JWT tokens for authentication
- Include in header: \`Authorization: Bearer <your_token>\`
      `,
      contact: {
        name: "Training Support",
        email: "nngann2402@gmail.com",
      },
      license: {
        name: "MIT License",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: BASE_URL,
        description: "Shared Widget API",
      },
    ],
    tags: [
      {
        name: "Authentication",
        description:
          "🔐 **Authentication Management**\n\nUser registration, login, and token management operations.",
      },
      {
        name: "User Management",
        description:
          "👤 **User Profile Management**\n\nManage user profile information and settings.",
      },
      {
        name: "Scan Management",
        description:
          "📸 **Scan Data Management**\n\nUpload, retrieve, update and delete scan records with images.",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your JWT token",
        },
      },
      schemas: {
        // Pair Schemas
        "PairMember": {
          "type": "object",
          "required": [
            "userId",
            "displayName",
            "slot"
          ],
          "properties": {
            "userId": {
              "type": "string",
              "format": "uuid"
            },
            "displayName": {
              "type": "string"
            },
            "slot": {
              "type": "integer",
              "enum": [
                1,
                2
              ]
            }
          }
        },
        "CurrentPair": {
          "type": "object",
          "nullable": true,
          "description": "The authenticated user's active pair; null when unpaired.",
          "required": [
            "pairId",
            "timezone",
            "anniversaryDate",
            "createdAt",
            "members"
          ],
          "properties": {
            "pairId": {
              "type": "string",
              "format": "uuid"
            },
            "timezone": {
              "type": "string",
              "example": "Asia/Ho_Chi_Minh"
            },
            "anniversaryDate": {
              "type": "string",
              "format": "date",
              "nullable": true
            },
            "createdAt": {
              "type": "string",
              "format": "date-time"
            },
            "members": {
              "type": "array",
              "minItems": 2,
              "maxItems": 2,
              "items": {
                "$ref": "#/components/schemas/PairMember"
              }
            }
          }
        },
        "PairAnniversaryRequest": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "anniversaryDate"
          ],
          "properties": {
            "anniversaryDate": {
              "type": "string",
              "format": "date",
              "nullable": true,
              "description": "A valid YYYY-MM-DD calendar date, or null to remove the anniversary."
            }
          }
        },
        "CurrentPairResponse": {
          "allOf": [
            {
              "$ref": "#/components/schemas/SuccessResponse"
            },
            {
              "type": "object",
              "required": [
                "statusCode",
                "message",
                "data",
                "timestamp"
              ],
              "properties": {
                "statusCode": {
                  "type": "integer",
                  "enum": [
                    200
                  ]
                },
                "data": {
                  "$ref": "#/components/schemas/CurrentPair"
                }
              }
            }
          ]
        },
        "PairAnniversaryResponse": {
          "allOf": [
            {
              "$ref": "#/components/schemas/SuccessResponse"
            },
            {
              "type": "object",
              "required": [
                "statusCode",
                "message",
                "data",
                "timestamp"
              ],
              "properties": {
                "statusCode": {
                  "type": "integer",
                  "enum": [
                    200
                  ]
                },
                "data": {
                  "type": "object",
                  "required": [
                    "pairId",
                    "anniversaryDate"
                  ],
                  "properties": {
                    "pairId": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "anniversaryDate": {
                      "type": "string",
                      "format": "date",
                      "nullable": true
                    }
                  }
                }
              }
            }
          ]
        },
        "PairDisconnectResponse": {
          "allOf": [
            {
              "$ref": "#/components/schemas/SuccessResponse"
            },
            {
              "type": "object",
              "required": [
                "statusCode",
                "message",
                "data",
                "timestamp"
              ],
              "properties": {
                "statusCode": {
                  "type": "integer",
                  "enum": [
                    200
                  ]
                },
                "data": {
                  "type": "object",
                  "nullable": true,
                  "enum": [
                    null
                  ],
                  "description": "Always null after a successful disconnect."
                }
              }
            }
          ]
        },

        // User Schemas
        User: {
          type: "object",
          properties: {
            userId: {
              type: "string",
              description: "Unique user identifier (UUID)",
            },
            email: {
              type: "string",
              format: "email",
              description: "User email address",
            },
            displayName: {
              type: "string",
              description: "User display name",
            },
            profilePic: {
              type: "string",
              format: "uri",
              description: "URL to profile picture",
            },
            methodSignUp: {
              type: "string",
              enum: ["email", "google", "facebook"],
              description: "Method used for signup",
            },
            role: {
              type: "string",
              enum: ["user", "admin"],
              description: "User role",
            },
            fcmToken: {
              type: "string",
              description: "Firebase Cloud Messaging token",
            },
            isActive: {
              type: "boolean",
              description: "Whether user is active/verified",
            },
            createdAt: {
              type: "string",
              format: "date-time",
              description: "Account creation timestamp",
            },
          },
        },
        UserRegistration: {
          type: "object",
          required: ["email", "password", "displayName"],
          properties: {
            displayName: {
              type: "string",
              minLength: 1,
              pattern: "\\S",
              description: "Display name, trimmed and non-empty; duplicates are allowed",
            },
            email: {
              type: "string",
              format: "email",
              description: "Valid email address",
            },
            password: {
              type: "string",
              minLength: 6,
              description: "Password (minimum 6 characters)",
            },
          },
        },
        VerificationCodeSent: {
          type: "object",
          properties: {
            otp: {
              type: "string",
              description: "The code itself, only returned when NODE_ENV=development",
            },
            email: {
              type: "string",
              format: "email",
              description: "Email the code was sent to",
            },
            emailMasked: {
              type: "string",
              description: "Email with part of the name hidden, for display",
            },
            expiresIn: {
              type: "string",
              description: "How long the code is valid",
            },
          },
        },
        UserLogin: {
          type: "object",
          required: ["email", "password", "deviceId"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
            deviceId: { type: "string", format: "uuid", description: "UUID v4 persisted per app installation" },
            deviceCredential: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Optional trusted-device secret; omission requires OTP" },
          },
        },
        UserProfile: {
          type: "object",
          required: ["displayName"],
          properties: {
            displayName: {
              type: "string",
              minLength: 1,
              pattern: "\\S",
              description: "User display name",
            },
          },
        },

        // Scan Schemas
        Scan: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: "Unique scan identifier",
            },
            label: {
              type: "string",
              description: "Scan label/diagnosis",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Confidence score",
            },
            time: {
              type: "string",
              format: "date-time",
              description: "Scan timestamp",
            },
            imageUrl: {
              type: "string",
              format: "uri",
              description: "Image URL",
            },
            type: {
              type: "string",
              default: "skin",
              description: "Scan type",
            },
            isRescan: {
              type: "boolean",
              default: false,
              description: "Whether this is a rescan",
            },
          },
        },
        ScanUpload: {
          type: "object",
          required: ["label", "confidence", "file"],
          properties: {
            label: {
              type: "string",
              description: "Scan label/diagnosis",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Confidence score (0-1)",
            },
            file: {
              type: "string",
              format: "binary",
              description: "Image file to upload",
            },
          },
        },

        // Response Schemas
        SuccessResponse: {
          type: "object",
          properties: {
            statusCode: {
              type: "integer",
              description: "HTTP status code",
            },
            message: {
              type: "string",
              description: "Success message",
            },
            timestamp: {
              type: "string",
              format: "date-time",
              description: "Response timestamp",
            },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            statusCode: {
              type: "integer",
              description: "HTTP status code",
            },
            error: {
              type: "string",
              description: "Error type",
            },
            message: {
              type: "string",
              description: "Error message",
            },
            timestamp: {
              type: "string",
              format: "date-time",
              description: "Error timestamp",
            },
          },
        },
        PaginatedResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {},
              description: "Array of data items",
            },
            pagination: {
              type: "object",
              properties: {
                currentPage: {
                  type: "integer",
                  description: "Current page number",
                },
                totalPages: {
                  type: "integer",
                  description: "Total number of pages",
                },
                totalItems: {
                  type: "integer",
                  description: "Total number of items",
                },
                itemsPerPage: {
                  type: "integer",
                  description: "Items per page",
                },
                hasNextPage: {
                  type: "boolean",
                  description: "Whether there is a next page",
                },
                hasPrevPage: {
                  type: "boolean",
                  description: "Whether there is a previous page",
                },
              },
            },
          },
        },
      },
    },
  },
 apis: [path.join(__dirname, "../routes/*.js").replace(/\\/g, "/")],
};

const specs = swaggerJSDoc(options);
const postcards = require("./postcardSwagger");
Object.assign(specs.paths, postcards.paths);
Object.assign(specs.components.schemas, postcards.schemas);
specs.tags.push({ name: "Postcards", description: "Shared drawing, private postcard images and realtime tickets" });

module.exports = {
  specs,
};

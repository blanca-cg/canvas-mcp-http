#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { z } from "zod";
import * as dotenv from "dotenv";
import { CanvasConfig, Course, Rubric } from './types.js';
import { CanvasClient } from './canvasClient.js';
import { registerCourseTools } from './tools/courses.js';
import { registerStudentTools } from './tools/students.js';
import { registerAssignmentTools } from './tools/assignments.js';
import { registerAssignmentGroupTools } from './tools/assignmentGroups.js';
import { registerModuleTools } from './tools/modules.js';
import { registerPageTools } from './tools/pages.js';
import { registerSectionTools } from './tools/sections.js';
import { registerSubmissionTools } from './tools/submissions.js';
import { registerRubricTools } from './tools/rubrics.js';
import { registerPrompts } from "./tools/prompts.js";
import { registerQuizTools } from "./tools/quizzes.js";
// Load environment variables
dotenv.config();

// Read configuration from environment variables
const config: CanvasConfig = {
  apiToken: process.env.CANVAS_API_TOKEN || "",
  baseUrl: process.env.CANVAS_BASE_URL || "https://fhict.instructure.com",
};

// Validate configuration
if (!config.apiToken) {
  console.error("Error: CANVAS_API_TOKEN environment variable is required");
  process.exit(1);
}

// Create the CanvasClient instance
const canvas = new CanvasClient(config.baseUrl, config.apiToken);

// Function to create and configure a new MCP server instance
function createServer(): McpServer {
  const server = new McpServer({
    name: "Canvas MCP Server",
    version: "1.0.0"
  });

  // Register all tools
  registerCourseTools(server, canvas);
  registerStudentTools(server, canvas);
  registerAssignmentTools(server, canvas);
  registerAssignmentGroupTools(server, canvas);
  registerModuleTools(server, canvas);
  registerPageTools(server, canvas);
  registerSectionTools(server, canvas);
  registerSubmissionTools(server, canvas);
  registerRubricTools(server, canvas);
  registerPrompts(server, canvas);
  registerQuizTools(server, canvas);

  return server;
}
// Start the server
async function startServer() {
  const PORT = process.env.PORT;

  if (PORT) {
    // HTTP mode for cloud deployment (using Streamable HTTP transport)
    console.error("Starting Canvas MCP Server in HTTP mode...");
    const app = express();

    // Store transports by session ID
    const transports = new Map<string, StreamableHTTPServerTransport>();

    app.use(cors());
    app.use(express.json());

    // Health check endpoint
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', server: 'Canvas MCP Server' });
    });

    // MCP endpoint (handles GET, POST, DELETE for Streamable HTTP)
    app.all('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      console.error(`MCP request: ${req.method} ${req.url}, session: ${sessionId || 'none'}`);

      // Get or create transport for this session
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        // Create new server instance and transport for new session
        const server = createServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            console.error(`New session initialized: ${newSessionId}`);
            transports.set(newSessionId, transport!);
          }
        });

        transport.onclose = () => {
          if (transport!.sessionId) {
            console.error(`Session closed: ${transport!.sessionId}`);
            transports.delete(transport!.sessionId);
          }
        };

        await server.connect(transport);
      }

      // Handle the request
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    app.listen(PORT, () => {
      console.error(`Canvas MCP Server running on http://0.0.0.0:${PORT}`);
      console.error(`MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
    });
  } else {
    // Stdio mode for local usage
    try {
      console.error("Starting Canvas MCP Server in stdio mode...");
      const server = createServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error("Canvas MCP Server running on stdio");
    } catch (error) {
      console.error("Fatal error:", error);
      process.exit(1);
    }
  }
}

startServer();
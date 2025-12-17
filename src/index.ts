#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
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
    // HTTP/SSE mode for cloud deployment
    console.error("Starting Canvas MCP Server in HTTP/SSE mode...");
    const app = express();

    // Store transports by session ID
    const transports = new Map<string, SSEServerTransport>();

    app.use(cors());
    app.use(express.json());

    // Health check endpoint
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', server: 'Canvas MCP Server' });
    });

    // SSE endpoint for MCP connection
    app.get('/sse', async (req, res) => {
      console.error('New SSE connection established');

      // Create a new server instance for this connection
      const server = createServer();
      const transport = new SSEServerTransport('/message', res);

      // Store transport by session ID
      transports.set(transport.sessionId, transport);

      // Clean up on close
      transport.onclose = () => {
        console.error(`SSE connection closed: ${transport.sessionId}`);
        transports.delete(transport.sessionId);
      };

      await server.connect(transport);
      await transport.start();
    });

    // Message endpoint for receiving client messages
    app.post('/message', async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);

      if (!transport) {
        console.error(`No transport found for session: ${sessionId}`);
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        console.error('Error handling message:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.listen(PORT, () => {
      console.error(`Canvas MCP Server running on http://0.0.0.0:${PORT}`);
      console.error(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
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
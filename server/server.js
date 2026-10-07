const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;

const SYSTEM_PROMPT = `You are AskBot, a friendly and concise AI assistant. Be helpful and warm but get to the point. Keep answers short, usually 2-4 sentences, unless the user asks for detail. Use simple everyday language and avoid jargon. If you don't know something or aren't sure, say so plainly and never make things up. Don't pad answers with long intros or repeated summaries. Use short markdown for lists or code.`;

// --------------------------------------------------
// BASIC SECURITY / CONFIGURATION
// --------------------------------------------------

app.disable("x-powered-by");

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
  })
);

// Prevent extremely large request bodies
app.use(
  express.json({
    limit: "50kb",
  })
);

// --------------------------------------------------
// SIMPLE IN-MEMORY RATE LIMITER
// --------------------------------------------------

const requestLog = new Map();

const RATE_LIMIT = 20;
const RATE_WINDOW = 60 * 1000;

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function isRateLimited(ip) {
  const now = Date.now();

  const timestamps = requestLog.get(ip) || [];

  const recentRequests = timestamps.filter(
    (timestamp) => now - timestamp < RATE_WINDOW
  );

  recentRequests.push(now);

  requestLog.set(ip, recentRequests);

  return recentRequests.length > RATE_LIMIT;
}

// Clean old IP entries periodically
setInterval(() => {
  const now = Date.now();

  for (const [ip, timestamps] of requestLog.entries()) {
    const recent = timestamps.filter(
      (timestamp) => now - timestamp < RATE_WINDOW
    );

    if (recent.length === 0) {
      requestLog.delete(ip);
    } else {
      requestLog.set(ip, recent);
    }
  }
}, RATE_WINDOW);

// --------------------------------------------------
// REQUEST TIMEOUT
// --------------------------------------------------

async function fetchWithTimeout(url, options, timeout = 20000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------
// VALIDATE CHAT REQUEST
// --------------------------------------------------

function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    return "Messages must be an array.";
  }

  if (messages.length === 0) {
    return "Please enter a message.";
  }

  // Prevent excessive context
  if (messages.length > 16) {
    return "Too many messages in the conversation.";
  }

  let totalCharacters = 0;

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      return "Invalid message format.";
    }

    if (!["user", "assistant"].includes(message.role)) {
      return "Invalid message role.";
    }

    if (typeof message.content !== "string") {
      return "Message content must be text.";
    }

    const content = message.content.trim();

    if (!content) {
      return "Message cannot be empty.";
    }

    if (content.length > 2000) {
      return "Message is too long. Please keep it under 2000 characters.";
    }

    totalCharacters += content.length;
  }

  // Protect against an unnecessarily huge conversation
  if (totalCharacters > 12000) {
    return "Conversation is too long. Please start a new chat.";
  }

  return null;
}

// --------------------------------------------------
// GROQ
// --------------------------------------------------

async function callGroq(messages) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key is not configured.");
  }

  if (!process.env.GROQ_MODEL) {
    throw new Error("Groq model is not configured.");
  }

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },

      body: JSON.stringify({
        model: process.env.GROQ_MODEL,
        messages,
        temperature: 0.5,
        max_tokens: 300,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Groq HTTP ${response.status}`);
  }

  const data = await response.json();

  const reply = data?.choices?.[0]?.message?.content;

  if (!reply || typeof reply !== "string") {
    throw new Error("Groq returned an invalid response.");
  }

  return reply.trim();
}

// --------------------------------------------------
// GEMINI FALLBACK
// --------------------------------------------------

async function callGemini(messages) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured.");
  }

  if (!process.env.GEMINI_MODEL) {
    throw new Error("Gemini model is not configured.");
  }

  const response = await fetchWithTimeout(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
      },

      body: JSON.stringify({
        model: process.env.GEMINI_MODEL,
        messages,
        temperature: 0.5,
        max_tokens: 300,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}`);
  }

  const data = await response.json();

  const reply = data?.choices?.[0]?.message?.content;

  if (!reply || typeof reply !== "string") {
    throw new Error("Gemini returned an invalid response.");
  }

  return reply.trim();
}

// --------------------------------------------------
// CHAT ENDPOINT
// --------------------------------------------------

app.post("/api/chat", async (req, res) => {
  const requestId = Math.random().toString(36).slice(2, 10);

  try {
    const ip = getClientIp(req);

    // -------------------------------
    // Rate limiting
    // -------------------------------

    if (isRateLimited(ip)) {
      return res.status(429).json({
        error:
          "You're sending messages too quickly. Please wait a moment and try again.",
      });
    }

    // -------------------------------
    // Validate request
    // -------------------------------

    const { messages } = req.body || {};

    const validationError = validateMessages(messages);

    if (validationError) {
      return res.status(400).json({
        error: validationError,
      });
    }

    // -------------------------------
    // Keep only latest conversation
    // -------------------------------

    const recentMessages = messages.slice(-16).map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));

    const conversation = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...recentMessages,
    ];

    // -------------------------------
    // Try Groq
    // -------------------------------

    try {
      const reply = await callGroq(conversation);

      return res.json({
        reply,
        provider: "Groq",
      });
    } catch (groqError) {
      console.error(
        `[${requestId}] Groq failed:`,
        groqError.message
      );
    }

    // -------------------------------
    // Try Gemini fallback
    // -------------------------------

    try {
      const reply = await callGemini(conversation);

      return res.json({
        reply,
        provider: "Gemini",
      });
    } catch (geminiError) {
      console.error(
        `[${requestId}] Gemini failed:`,
        geminiError.message
      );
    }

    // -------------------------------
    // Both providers failed
    // -------------------------------

    return res.status(503).json({
      error:
        "Our AI services are temporarily unavailable. Please try again in a moment.",
    });

  } catch (error) {
    console.error(
      `[${requestId}] Unexpected server error:`,
      error.message
    );

    return res.status(500).json({
      error:
        "Something went wrong on our server. Please try again.",
    });
  }
});

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "AskBot backend",
  });
});

// --------------------------------------------------
// HANDLE UNKNOWN ROUTES
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "The requested endpoint does not exist.",
  });
});

// --------------------------------------------------
// HANDLE INVALID JSON
// --------------------------------------------------

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: "Invalid request format.",
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request is too large.",
    });
  }

  next(error);
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(`AskBot server running on http://localhost:${PORT}`);
});
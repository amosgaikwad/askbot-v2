import "./App.css";
import { useRef, useState } from "react";

const MAX_MESSAGE_LENGTH = 2000;
const REQUEST_TIMEOUT = 25000;

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Keeps track of the current request
  const controllerRef = useRef(null);

  // Used to distinguish manual Stop from timeout
  const manuallyStoppedRef = useRef(false);

  // ==========================================
  // SEND MESSAGE
  // ==========================================

  const sendMessage = async () => {
    const text = message.trim();

    if (!text) {
      setError("Please enter a message first.");
      return;
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      setError(
        `Your message is too long. Please keep it under ${MAX_MESSAGE_LENGTH} characters.`
      );
      return;
    }

    if (loading) {
      return;
    }

    setError("");
    manuallyStoppedRef.current = false;

    const userMessage = {
      role: "user",
      content: text,
    };

    const updatedMessages = [
      ...messages,
      userMessage,
    ];

    setMessages(updatedMessages);
    setMessage("");
    setLoading(true);

    const controller = new AbortController();

    controllerRef.current = controller;

    let timeoutId;

    try {
      // ========================================
      // REQUEST TIMEOUT
      // ========================================

      timeoutId = setTimeout(() => {
        if (controllerRef.current === controller) {
          controller.abort();
        }
      }, REQUEST_TIMEOUT);

      // ========================================
      // API REQUEST
      // ========================================

      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: updatedMessages,
          }),
          signal: controller.signal,
        }
      );

      // ========================================
      // READ RESPONSE
      // ========================================

      let data = {};

      try {
        data = await response.json();
      } catch {
        throw new Error(
          "The server returned an invalid response."
        );
      }

      // ========================================
      // SERVER ERROR
      // ========================================

      if (!response.ok) {
        if (response.status === 400) {
          throw new Error(
            data.error ||
              "Your request could not be processed."
          );
        }

        if (response.status === 429) {
          throw new Error(
            data.error ||
              "You're sending messages too quickly. Please wait a moment."
          );
        }

        if (response.status === 503) {
          throw new Error(
            data.error ||
              "Our AI services are temporarily unavailable. Please try again."
          );
        }

        throw new Error(
          data.error ||
            "The server encountered a problem. Please try again."
        );
      }

      // ========================================
      // VALIDATE AI RESPONSE
      // ========================================

      if (
        !data.reply ||
        typeof data.reply !== "string"
      ) {
        throw new Error(
          "The AI returned an invalid response. Please try again."
        );
      }

      // ========================================
      // ADD AI RESPONSE
      // ========================================

      setMessages((previousMessages) => [
        ...previousMessages,
        {
          role: "assistant",
          content: data.reply,
          provider: data.provider,
        },
      ]);
    } catch (err) {
      console.error(
        "Chat request failed:",
        err
      );

      // ========================================
      // MANUAL STOP
      // ========================================

      if (
        err.name === "AbortError" &&
        manuallyStoppedRef.current
      ) {
        return;
      }

      // ========================================
      // TIMEOUT
      // ========================================

      if (err.name === "AbortError") {
        setError(
          "The request took too long. Please try again."
        );

        return;
      }

      // ========================================
      // BACKEND CONNECTION ERROR
      // ========================================

      if (err instanceof TypeError) {
        setError(
          "I can't connect to the AskBot server. Please make sure the backend is running."
        );

        return;
      }

      // ========================================
      // NORMAL ERROR
      // ========================================

      setError(
        err.message ||
          "Something went wrong. Please try again."
      );
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Only clear the controller if this
      // request is still the active request.
      if (
        controllerRef.current === controller
      ) {
        controllerRef.current = null;
      }

      setLoading(false);
    }
  };

  // ==========================================
  // STOP GENERATION
  // ==========================================

  const stopMessage = () => {
    const controller =
      controllerRef.current;

    if (!controller) {
      return;
    }

    // Mark it as a manual stop BEFORE aborting.
    manuallyStoppedRef.current = true;

    controller.abort();

    controllerRef.current = null;

    setLoading(false);
    setError("Generation stopped.");
  };

  // ==========================================
  // CLEAR CHAT
  // ==========================================

  const clearChat = () => {
    if (loading) {
      return;
    }

    setMessages([]);
    setMessage("");
    setError("");

    manuallyStoppedRef.current = false;
  };

  // ==========================================
  // RETRY
  // ==========================================

  const retryLastMessage = () => {
    if (loading || messages.length === 0) {
      return;
    }

    const lastUserIndex =
      messages
        .map((msg) => msg.role)
        .lastIndexOf("user");

    if (lastUserIndex === -1) {
      return;
    }

    const lastUserMessage =
      messages[lastUserIndex];

    setMessages(
      messages.slice(0, lastUserIndex)
    );

    setMessage(
      lastUserMessage.content
    );

    setError("");
  };

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="app">

      <div className="chat-container">

        {/* HEADER */}

        <header className="header">

          <div className="brand">

            <div className="bot-icon">
              🤖
            </div>

            <div>
              <h1>AskBot</h1>

              <span>
                Your friendly AI assistant
              </span>
            </div>

          </div>

          <button
            className="clear-button"
            onClick={clearChat}
            disabled={loading}
          >
            🗑 Clear
          </button>

        </header>


        {/* CHAT AREA */}

        <main className="chat-area">

          {messages.length === 0 ? (

            <div className="welcome">

              <div className="welcome-icon">
                ✨
              </div>

              <h2>
                How can I help you?
              </h2>

              <p>
                Ask me anything and I'll give
                you a clear, concise answer.
              </p>

            </div>

          ) : (

            <div className="messages">

              {messages.map(
                (msg, index) => (

                  <div
                    key={index}
                    className={
                      msg.role === "user"
                        ? "message-row user-row"
                        : "message-row bot-row"
                    }
                  >

                    <div className="avatar">
                      {msg.role === "user"
                        ? "👤"
                        : "🤖"}
                    </div>

                    <div
                      className={
                        msg.role === "user"
                          ? "message-bubble user-message"
                          : "message-bubble bot-message"
                      }
                    >

                      <p>
                        {msg.content}
                      </p>

                      {msg.provider && (
                        <span className="provider">
                          Powered by{" "}
                          {msg.provider}
                        </span>
                      )}

                    </div>

                  </div>
                )
              )}


              {/* TYPING INDICATOR */}

              {loading && (

                <div className="message-row bot-row">

                  <div className="avatar">
                    🤖
                  </div>

                  <div className="message-bubble bot-message typing">

                    <span></span>
                    <span></span>
                    <span></span>

                  </div>

                </div>

              )}

            </div>

          )}

        </main>


        {/* ERROR */}

        {error && (

          <div className="error-area">

            <div className="error-message">
              ⚠️ {error}
            </div>

            <button
              className="retry-button"
              onClick={retryLastMessage}
              disabled={loading}
            >
              Retry
            </button>

          </div>

        )}


        {/* INPUT */}

        <div className="input-section">

          <div className="input-box">

            <textarea
              value={message}
              onChange={(e) => {

                setMessage(
                  e.target.value
                );

                if (error) {
                  setError("");
                }

              }}
              onKeyDown={(e) => {

                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !loading
                ) {
                  e.preventDefault();
                  sendMessage();
                }

              }}
              placeholder="Message AskBot..."
              rows="1"
              maxLength={MAX_MESSAGE_LENGTH}
              disabled={loading}
            />


            {/* SEND / STOP */}

            <button
              className="send-button"
              onClick={
                loading
                  ? stopMessage
                  : sendMessage
              }
              disabled={
                !loading &&
                !message.trim()
              }
              title={
                loading
                  ? "Stop generation"
                  : "Send message"
              }
              aria-label={
                loading
                  ? "Stop generation"
                  : "Send message"
              }
            >
              {loading ? "■" : "➤"}
            </button>

          </div>


          <div className="input-footer">

            <p className="input-hint">

              {loading
                ? "AskBot is thinking... Click ■ to stop"
                : "Enter to send • Shift + Enter for a new line"}

            </p>

            <span
              className={
                message.length >=
                MAX_MESSAGE_LENGTH
                  ? "character-count limit"
                  : "character-count"
              }
            >
              {message.length}/
              {MAX_MESSAGE_LENGTH}
            </span>

          </div>

        </div>

      </div>

    </div>
  );
}

export default App;
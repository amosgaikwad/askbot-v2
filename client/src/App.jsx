import "./App.css";
import { useRef, useState } from "react";

const MAX_MESSAGE_LENGTH = 2000;
const REQUEST_TIMEOUT = 25000;

function BrandMark({ small = false }) {
  return (
    <span className={`brand-mark${small ? " brand-mark-small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 36 36" fill="none">
        <rect x="2" y="2" width="32" height="32" rx="10" fill="currentColor" opacity=".09" />
        <path d="M11 13.5h14M11 18h9M11 22.5h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="25.5" cy="23" r="3.5" fill="#6D5CE8" />
      </svg>
    </span>
  );
}

function Icon({ name, size = 18 }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const icons = {
    trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 10v6M14 10v6" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    retry: <><path d="M20 7v5h-5" /><path d="M4.9 9A8 8 0 0 1 18.6 6L20 12" /><path d="M4 17v-5h5" /><path d="M19.1 15A8 8 0 0 1 5.4 18L4 12" /></>,
    sparkle: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg {...props}>{icons[name]}</svg>;
}

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("groq");
  const controllerRef = useRef(null);
  const manuallyStoppedRef = useRef(false);

  const sendMessage = async (overrideText) => {
    const text = (overrideText ?? message).trim();
    if (!text) return setError("Please enter a message first.");
    if (text.length > MAX_MESSAGE_LENGTH) return setError(`Please keep your message under ${MAX_MESSAGE_LENGTH} characters.`);
    if (loading) return;

    setError("");
    manuallyStoppedRef.current = false;
    const updatedMessages = [...messages, { role: "user", content: text }];
    setMessages(updatedMessages);
    setMessage("");
    setLoading(true);

    const controller = new AbortController();
    controllerRef.current = controller;
    let timeoutId;

    try {
      timeoutId = setTimeout(() => {
        if (controllerRef.current === controller) controller.abort();
      }, REQUEST_TIMEOUT);

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages, provider: selectedProvider }),
        signal: controller.signal,
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        throw new Error("The server returned an invalid response.");
      }

      if (!response.ok) {
        if (response.status === 429) throw new Error(data.error || "You're sending messages too quickly. Please wait a moment.");
        if (response.status === 503) throw new Error(data.error || "Our AI services are temporarily unavailable. Please try again.");
        throw new Error(data.error || "The server encountered a problem. Please try again.");
      }
      if (!data.reply || typeof data.reply !== "string") throw new Error("The AI returned an invalid response. Please try again.");

      setMessages((previous) => [...previous, { role: "assistant", content: data.reply, provider: data.provider }]);
    } catch (err) {
      if (err.name === "AbortError" && manuallyStoppedRef.current) return;
      if (err.name === "AbortError") setError("The request took too long. Please try again.");
      else if (err instanceof TypeError) setError("I can't connect to the AskBot server. Please try again in a moment.");
      else setError(err.message || "Something went wrong. Please try again.");
      console.error("Chat request failed:", err);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (controllerRef.current === controller) controllerRef.current = null;
      setLoading(false);
    }
  };

  const stopMessage = () => {
    if (!controllerRef.current) return;
    manuallyStoppedRef.current = true;
    controllerRef.current.abort();
    controllerRef.current = null;
    setLoading(false);
    setError("Generation stopped.");
  };

  const clearChat = () => {
    if (loading) return;
    setMessages([]);
    setMessage("");
    setError("");
    manuallyStoppedRef.current = false;
  };

  const retryLastMessage = () => {
    if (loading || messages.length === 0) return;
    const lastUserIndex = messages.map((item) => item.role).lastIndexOf("user");
    if (lastUserIndex === -1) return;
    setMessage(messages[lastUserIndex].content);
    setMessages(messages.slice(0, lastUserIndex));
    setError("");
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!loading) sendMessage();
  };

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <a className="brand" href="/" aria-label="AskBot home">
            <BrandMark />
            <span className="brand-name">askbot<span className="brand-period">.</span></span>
          </a>
          <div className="topbar-right">
            <div className="model-switcher" role="group" aria-label="Choose AI provider">
              <span className="model-switcher-label">Model</span>
              <button
                type="button"
                className={`model-option${selectedProvider === "groq" ? " active" : ""}`}
                onClick={() => setSelectedProvider("groq")}
                aria-pressed={selectedProvider === "groq"}
                disabled={loading}
              >
                Groq
              </button>
              <button
                type="button"
                className={`model-option${selectedProvider === "gemini" ? " active" : ""}`}
                onClick={() => setSelectedProvider("gemini")}
                aria-pressed={selectedProvider === "gemini"}
                disabled={loading}
              >
                Gemini
              </button>
            </div>
            <span className="status-label"><span className="status-dot" /> AI assistant</span>
            <span className="topbar-divider" />
            <button className="clear-button" onClick={clearChat} disabled={loading || messages.length === 0} type="button">
              <Icon name="trash" size={15} /> <span>Clear chat</span>
            </button>
          </div>
        </header>

        <section className={`conversation${messages.length ? " has-messages" : ""}`} aria-label="Conversation">
          {messages.length === 0 ? (
            <div className="welcome-screen">
              <div className="welcome-mark"><BrandMark /></div>
              <p className="eyebrow"><span className="eyebrow-line" /> A little help goes a long way</p>
              <h1>What’s on your mind<span className="heading-period">?</span></h1>
              <p className="welcome-copy">Ask a question, explore an idea, or work through something. I’m here to help you think it through.</p>
              <div className="suggestion-grid">
                <button type="button" className="suggestion-card" onClick={() => sendMessage("Explain a complex idea in simple terms.")} disabled={loading}>
                  <span className="suggestion-icon"><Icon name="sparkle" size={17} /></span>
                  <span className="suggestion-title">Explain something</span>
                  <span className="suggestion-description">Make a complex topic easier to understand</span><span className="suggestion-arrow">↗</span>
                </button>
                <button type="button" className="suggestion-card" onClick={() => sendMessage("Help me brainstorm ideas for a project.")} disabled={loading}>
                  <span className="suggestion-icon"><span className="idea-glyph">✳</span></span>
                  <span className="suggestion-title">Brainstorm ideas</span>
                  <span className="suggestion-description">Get unstuck and find a fresh perspective</span><span className="suggestion-arrow">↗</span>
                </button>
                <button type="button" className="suggestion-card" onClick={() => sendMessage("Help me write a clear, professional message.")} disabled={loading}>
                  <span className="suggestion-icon"><span className="write-glyph">Aa</span></span>
                  <span className="suggestion-title">Write something</span>
                  <span className="suggestion-description">Turn your thoughts into the right words</span><span className="suggestion-arrow">↗</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((msg, index) => (
                <article key={`${msg.role}-${index}`} className={`message-row ${msg.role === "user" ? "user-row" : "assistant-row"}`}>
                  {msg.role === "assistant" && <div className="message-mark"><BrandMark small /></div>}
                  <div className="message-content">
                    <div className="message-author">{msg.role === "user" ? "You" : "AskBot"}</div>
                    <div className="message-text">{msg.content}</div>
                  </div>
                </article>
              ))}
              {loading && <article className="message-row assistant-row"><div className="message-mark"><BrandMark small /></div><div className="message-content"><div className="message-author">AskBot</div><div className="typing-indicator" aria-label="AskBot is thinking"><span /><span /><span /></div></div></article>}
            </div>
          )}
        </section>

        
        {error && (
          <div className="error-row" role="alert">
            <span>{error}</span>

            <button
              className="retry-button"
              onClick={retryLastMessage}
              disabled={loading}
              type="button"
            >
              <Icon name="retry" size={14} />
              Retry
            </button>

            <button
              className="dismiss-error"
              onClick={() => setError("")}
              type="button"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}


        <footer className="composer-area">
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              value={message}
              onChange={(event) => { setMessage(event.target.value); if (error) setError(""); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !loading) { event.preventDefault(); sendMessage(); }
              }}
              placeholder="Message AskBot…"
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH}
              disabled={loading}
              aria-label="Message AskBot"
            />
            <div className="composer-actions">
              <span className={`character-count${message.length >= MAX_MESSAGE_LENGTH ? " limit" : ""}`}>{message.length > 0 ? `${message.length}/${MAX_MESSAGE_LENGTH}` : " "}</span>
              <button className={`send-button${loading ? " is-stop" : ""}`} type={loading ? "button" : "submit"} onClick={loading ? stopMessage : undefined} disabled={!loading && !message.trim()} title={loading ? "Stop generation" : "Send message"} aria-label={loading ? "Stop generation" : "Send message"}>
                {loading ? <Icon name="stop" size={16} /> : <Icon name="send" size={17} />}
              </button>
            </div>
          </form>
          <div className="composer-meta">
            <span>{loading ? "AskBot is thinking…" : <>Press <kbd>Enter</kbd> to send <span className="meta-separator">·</span> <kbd>Shift + Enter</kbd> for a new line</>}</span>
            <span className="privacy-note">Using {selectedProvider === "groq" ? "Groq" : "Gemini"}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

export default App;

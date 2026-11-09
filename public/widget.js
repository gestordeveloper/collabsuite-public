(function () {
  // Ensure the widget is only initialized once
  if (window.CollabSupportWidget) return;

  let config = {};
  let session = {
    token: null,
    user: null,
    funnel: null,
  };
  let apiBaseUrl = "";
  let activeView = "list"; // "list", "create", "chat"
  let selectedTicketId = null;
  let tickets = [];
  let activities = [];
  let pollInterval = null;
  let pendingTicketFile = null;
  let pendingChatFile = null;

  // DOM references
  let widgetContainer = null;
  let widgetFab = null;
  let widgetWindow = null;

  // Determine API Base URL from the script source
  const scripts = document.getElementsByTagName("script");
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].src;
    if (src && src.includes("/widget/script.js")) {
      try {
        const url = new URL(src);
        apiBaseUrl = url.origin;
      } catch (e) {
        console.error("CollabSupportWidget: Error parsing script URL", e);
      }
      break;
    }
  }

  // Fallback if not found via script tag url
  if (!apiBaseUrl) {
    apiBaseUrl = window.location.origin;
  }

  // Scoped CSS styles injected dynamically
  function injectStyles(themeColor) {
    const styleId = "collab-widget-styles";
    if (document.getElementById(styleId)) {
      document.getElementById(styleId).remove();
    }

    const css = `
      /* Font */
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

      .csw-theme {
        --csw-primary: ${themeColor || "#ec1889"};
        --csw-primary-hover: ${adjustColorBrightness(themeColor || "#ec1889", -15)};
        --csw-bg: #ffffff;
        --csw-text: #1e293b;
        --csw-border: #e2e8f0;
        --csw-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      /* FAB Button */
      #csw-fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background-color: var(--csw-primary);
        color: #ffffff;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 999999;
      }
      #csw-fab:hover {
        transform: scale(1.08) translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
        background-color: var(--csw-primary-hover);
      }
      #csw-fab svg {
        width: 26px;
        height: 26px;
        fill: currentColor;
        transition: transform 0.4s ease;
      }
      #csw-fab.active svg {
        transform: rotate(90deg);
      }

      /* Chat Window container */
      #csw-window {
        position: fixed;
        bottom: 96px;
        right: 24px;
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 120px);
        background-color: var(--csw-bg);
        border-radius: 16px;
        box-shadow: var(--csw-shadow);
        border: 1px solid var(--csw-border);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 999999;
        opacity: 0;
        transform: translateY(20px) scale(0.95);
        pointer-events: none;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #csw-window.active {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      /* Responsive layout for small viewports */
      @media (max-width: 480px) {
        #csw-window {
          bottom: 0;
          right: 0;
          width: 100vw;
          height: 100vh;
          max-height: 100vh;
          border-radius: 0;
          border: none;
        }
        #csw-fab {
          bottom: 16px;
          right: 16px;
        }
      }

      /* Window Header */
      .csw-header {
        background-color: var(--csw-primary);
        color: #ffffff;
        padding: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      }
      .csw-header-title {
        font-weight: 600;
        font-size: 16px;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-grow: 1;
      }
      .csw-header-subtitle {
        font-size: 11px;
        opacity: 0.85;
        margin-top: 2px;
      }
      .csw-header-btn {
        background: transparent;
        border: none;
        color: #ffffff;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
        width: 32px;
        height: 32px;
      }
      .csw-header-btn:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      .csw-header-btn svg {
        width: 18px;
        height: 18px;
        fill: currentColor;
      }

      /* Body & Views */
      .csw-body {
        flex-grow: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        background-color: #f8fafc;
        position: relative;
      }
      .csw-view {
        display: none;
        flex-direction: column;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
      }
      .csw-view.active {
        display: flex;
      }

      /* Ticket List View */
      .csw-list-container {
        padding: 16px;
        overflow-y: auto;
        flex-grow: 1;
        box-sizing: border-box;
      }
      .csw-user-welcome {
        font-size: 14px;
        font-weight: 500;
        color: #64748b;
        margin-bottom: 16px;
      }
      .csw-ticket-card {
        background: #ffffff;
        border: 1px solid var(--csw-border);
        border-radius: 12px;
        padding: 14px;
        margin-bottom: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .csw-ticket-card:hover {
        border-color: var(--csw-primary);
        transform: translateY(-1px);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      }
      .csw-ticket-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
      }
      .csw-ticket-title {
        font-size: 14px;
        font-weight: 600;
        color: #0f172a;
        margin: 0;
        line-height: 1.4;
      }
      .csw-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 9999px;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .csw-badge-notdone {
        background-color: #dbeafe;
        color: #1e40af;
      }
      .csw-badge-inprogress {
        background-color: #fef3c7;
        color: #92400e;
      }
      .csw-badge-done {
        background-color: #d1fae5;
        color: #065f46;
      }
      .csw-ticket-reason {
        font-size: 11px;
        color: #64748b;
        background: #f1f5f9;
        padding: 1px 6px;
        border-radius: 4px;
        display: inline-block;
        margin-top: 6px;
      }
      .csw-ticket-preview {
        font-size: 12px;
        color: #475569;
        margin: 8px 0 0 0;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.4;
      }
      .csw-ticket-meta {
        font-size: 10px;
        color: #94a3b8;
        margin-top: 10px;
        display: flex;
        justify-content: space-between;
      }

      /* Empty State */
      .csw-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        text-align: center;
        color: #64748b;
        flex-grow: 1;
      }
      .csw-empty-icon {
        width: 64px;
        height: 64px;
        color: #cbd5e1;
        margin-bottom: 16px;
      }
      .csw-empty-text {
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 8px;
      }
      .csw-empty-subtext {
        font-size: 12px;
        color: #94a3b8;
      }

      /* Footer / Action panel */
      .csw-footer {
        padding: 16px;
        background: #ffffff;
        border-top: 1px solid var(--csw-border);
        box-sizing: border-box;
      }
      .csw-btn {
        width: 100%;
        background-color: var(--csw-primary);
        color: #ffffff;
        border: none;
        border-radius: 10px;
        padding: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: background-color 0.2s;
      }
      .csw-btn:hover {
        background-color: var(--csw-primary-hover);
      }
      .csw-btn svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }

      /* Create Form View */
      .csw-form {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        overflow-y: auto;
        box-sizing: border-box;
        flex-grow: 1;
      }
      .csw-form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .csw-label {
        font-size: 12px;
        font-weight: 600;
        color: #475569;
      }
      .csw-input, .csw-select, .csw-textarea {
        font-family: inherit;
        font-size: 14px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--csw-border);
        background: #ffffff;
        color: var(--csw-text);
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.2s;
      }
      .csw-input:focus, .csw-select:focus, .csw-textarea:focus {
        border-color: var(--csw-primary);
        box-shadow: 0 0 0 3px rgba(236, 24, 137, 0.1);
      }
      .csw-textarea {
        resize: none;
        height: 120px;
      }

      /* Chat / Conversation View */
      .csw-chat-feed {
        flex-grow: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-sizing: border-box;
      }
      .csw-message-bubble {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.5;
        position: relative;
        word-break: break-word;
      }
      .csw-msg-left {
        align-self: flex-start;
        background-color: #ffffff;
        color: #1e293b;
        border: 1px solid var(--csw-border);
        border-bottom-left-radius: 3px;
      }
      .csw-msg-right {
        align-self: flex-end;
        background-color: var(--csw-primary);
        color: #ffffff;
        border-bottom-right-radius: 3px;
      }
      .csw-msg-sender {
        font-size: 9px;
        font-weight: 600;
        color: #64748b;
        margin-bottom: 3px;
      }
      .csw-msg-right .csw-msg-sender {
        color: rgba(255, 255, 255, 0.7);
        text-align: right;
      }
      .csw-msg-time {
        font-size: 9px;
        color: #94a3b8;
        margin-top: 4px;
        text-align: right;
        display: block;
      }
      .csw-msg-right .csw-msg-time {
        color: rgba(255, 255, 255, 0.6);
      }

      /* Chat input panel */
      .csw-chat-input-panel {
        display: flex;
        gap: 8px;
        padding: 12px;
        background: #ffffff;
        border-top: 1px solid var(--csw-border);
        box-sizing: border-box;
      }
      .csw-chat-input {
        flex-grow: 1;
        font-family: inherit;
        font-size: 13px;
        padding: 8px 12px;
        border: 1px solid var(--csw-border);
        border-radius: 20px;
        outline: none;
        box-sizing: border-box;
        background: #f8fafc;
      }
      .csw-chat-input:focus {
        border-color: var(--csw-primary);
        background: #ffffff;
      }
      .csw-chat-send-btn {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background-color: var(--csw-primary);
        color: #ffffff;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background-color 0.2s;
      }
      .csw-chat-send-btn:hover {
        background-color: var(--csw-primary-hover);
      }
      .csw-chat-send-btn svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
        margin-left: 2px;
      }

      /* Ticket Status Summary under header */
      .csw-chat-ticket-bar {
        background: #ffffff;
        border-bottom: 1px solid var(--csw-border);
        padding: 10px 16px;
        font-size: 12px;
        color: #475569;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      /* Attachments */
      .csw-hidden-file-input {
        display: none;
      }
      .csw-attach-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        padding: 8px 12px;
        font-size: 12px;
        font-family: inherit;
        color: #475569;
        background: #f8fafc;
        border: 1px dashed var(--csw-border);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .csw-attach-btn:hover {
        border-color: var(--csw-primary);
        color: var(--csw-primary);
      }
      .csw-attach-btn svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
      }
      .csw-attach-icon-btn {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: transparent;
        color: #64748b;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background-color 0.2s;
      }
      .csw-attach-icon-btn:hover {
        background-color: #f1f5f9;
        color: var(--csw-primary);
      }
      .csw-attach-icon-btn svg {
        width: 18px;
        height: 18px;
        fill: currentColor;
      }
      .csw-file-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding: 6px 10px;
        background: #f1f5f9;
        border: 1px solid var(--csw-border);
        border-radius: 8px;
        font-size: 11px;
      }
      #csw-chat-file-preview .csw-file-chip {
        margin: 0 12px;
      }
      .csw-file-chip-name {
        flex-grow: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
        color: #1e293b;
      }
      .csw-file-chip-size {
        color: #94a3b8;
        flex-shrink: 0;
      }
      .csw-file-chip-remove {
        background: none;
        border: none;
        cursor: pointer;
        color: #94a3b8;
        padding: 0;
        display: flex;
        flex-shrink: 0;
      }
      .csw-file-chip-remove:hover {
        color: #ef4444;
      }
      .csw-file-chip-remove svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
      }
      .csw-msg-attachment-img {
        display: block;
        max-width: 100%;
        max-height: 180px;
        border-radius: 8px;
        margin-top: 4px;
        object-fit: cover;
      }
      .csw-msg-attachment-video {
        display: block;
        max-width: 100%;
        max-height: 180px;
        border-radius: 8px;
        margin-top: 4px;
      }
      .csw-msg-attachment-file {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        padding: 6px 10px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.06);
        color: inherit;
        text-decoration: none;
        font-size: 12px;
        font-weight: 600;
      }
      .csw-msg-attachment-file svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
        flex-shrink: 0;
      }
      .csw-msg-attachment-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Spinners and loaders */
      .csw-spinner {
        border: 3px solid rgba(0,0,0,0.05);
        border-radius: 50%;
        border-top: 3px solid var(--csw-primary);
        width: 24px;
        height: 24px;
        animation: csw-spin 0.8s linear infinite;
        margin: 20px auto;
      }
      @keyframes csw-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;

    const style = document.createElement("style");
    style.id = styleId;
    style.type = "text/css";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  // Adjusts colors for hover state
  function adjustColorBrightness(hex, percent) {
    let R = parseInt(hex.substring(1, 3), 16);
    let G = parseInt(hex.substring(3, 5), 16);
    let B = parseInt(hex.substring(5, 7), 16);

    R = parseInt((R * (100 + percent)) / 100);
    G = parseInt((G * (100 + percent)) / 100);
    B = parseInt((B * (100 + percent)) / 100);

    R = R < 255 ? R : 255;
    G = G < 255 ? G : 255;
    B = B < 255 ? B : 255;

    const rHex = R.toString(16).padStart(2, "0");
    const gHex = G.toString(16).padStart(2, "0");
    const bHex = B.toString(16).padStart(2, "0");

    return `#${rHex}${gHex}${bHex}`;
  }

  // Safe wrapper for API calls
  async function apiCall(endpoint, method = "GET", body = null) {
    const headers = {
      "Content-Type": "application/json",
    };
    if (session.token) {
      headers["Authorization"] = `Bearer ${session.token}`;
    }

    const options = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${apiBaseUrl}${endpoint}`, options);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  // Uploads a file (photo, video, document, screenshot) and returns its stored URL + metadata.
  // Uses a raw fetch with FormData instead of apiCall, since apiCall always sends JSON.
  async function uploadWidgetAttachment(file) {
    const formData = new FormData();
    formData.append("file", file);

    const headers = {};
    if (session.token) {
      headers["Authorization"] = `Bearer ${session.token}`;
    }

    const response = await fetch(`${apiBaseUrl}/api/public/widget/upload`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error! status: ${response.status}`);
    }
    return response.json(); // { url, name, size, type }
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Formatting timestamp helper
  function formatRelativeTime(dateStr) {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "Agora mesmo";
      if (diffMins < 60) return `Há ${diffMins} min`;
      if (diffHours < 24) return `Há ${diffHours}h`;
      if (diffDays === 1) return "Ontem";
      if (diffDays < 7) return `Há ${diffDays} dias`;
      return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case "inprogress":
        return "Em Andamento";
      case "done":
        return "Resolvido";
      case "notdone":
      default:
        return "Aberto";
    }
  }

  // Initialize the Widget User and elements
  async function init(userConfig) {
    config = userConfig;
    if (!config.funnel_id || !config.email || !config.first_name) {
      console.error("CollabSupportWidget: Missing configuration fields. funnel_id, email, and first_name are required.");
      return;
    }

    try {
      // 1. Authenticate & initialize widget user
      const res = await apiCall("/api/public/widget/initialize", "POST", {
        funnel_id: config.funnel_id,
        user_id: config.user_id,
        first_name: config.first_name,
        last_name: config.last_name,
        email: config.email,
        telephone: config.telephone,
      });

      session.token = res.token;
      session.user = res.user;
      session.funnel = res.funnel;

      // 2. Setup theme styles and generate UI
      injectStyles(session.funnel.color);
      createDOM();
      
      // Load initial tickets
      await loadTickets();

    } catch (err) {
      console.error("CollabSupportWidget initialization failed:", err);
    }
  }

  // Build the DOM elements for FAB and chat
  function createDOM() {
    // 1. Create a wrapper element with theme variables
    widgetContainer = document.createElement("div");
    widgetContainer.className = "csw-theme";
    document.body.appendChild(widgetContainer);

    // 2. Create Floating Action Button (FAB)
    widgetFab = document.createElement("button");
    widgetFab.id = "csw-fab";
    widgetFab.title = "Suporte";
    widgetFab.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
    `;
    widgetFab.addEventListener("click", toggleWidgetWindow);
    widgetContainer.appendChild(widgetFab);

    // 3. Create Support Window
    widgetWindow = document.createElement("div");
    widgetWindow.id = "csw-window";
    widgetContainer.appendChild(widgetWindow);

    renderHeader();
    renderBody();

    // Set active view
    changeView("list");
  }

  function toggleWidgetWindow() {
    const isActive = widgetWindow.classList.toggle("active");
    widgetFab.classList.toggle("active", isActive);

    if (isActive) {
      loadTickets();
      // Start polling for new messages when open
      startPolling();
    } else {
      stopPolling();
    }
  }

  function startPolling() {
    stopPolling();
    pollInterval = setInterval(() => {
      if (activeView === "chat" && selectedTicketId) {
        loadActivities(selectedTicketId, true);
      } else if (activeView === "list") {
        loadTickets(true);
      }
    }, 6000); // Poll every 6 seconds
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function renderHeader() {
    const funnelName = session.funnel ? session.funnel.name : "Suporte";
    widgetWindow.innerHTML = `
      <div class="csw-header">
        <button class="csw-header-btn" id="csw-btn-back" style="display: none;">
          <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </button>
        <div style="flex-grow: 1; min-w: 0; padding-left: 6px;">
          <h3 class="csw-header-title">${funnelName}</h3>
          <div class="csw-header-subtitle">Central de Chamados</div>
        </div>
        <button class="csw-header-btn" id="csw-btn-close">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="csw-body" id="csw-body-root"></div>
    `;

    document.getElementById("csw-btn-close").addEventListener("click", toggleWidgetWindow);
    const backBtn = document.getElementById("csw-btn-back");
    backBtn.addEventListener("click", () => {
      if (activeView === "chat") {
        changeView("list");
      } else if (activeView === "create") {
        changeView("list");
      }
    });
  }

  function renderBody() {
    const bodyRoot = document.getElementById("csw-body-root");
    
    bodyRoot.innerHTML = `
      <!-- LIST VIEW -->
      <div class="csw-view" id="csw-view-list">
        <div class="csw-list-container" id="csw-ticket-list-root"></div>
        <div class="csw-footer">
          <button class="csw-btn" id="csw-btn-new-ticket">
            <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            Novo Chamado
          </button>
        </div>
      </div>

      <!-- CREATE TICKET VIEW -->
      <div class="csw-view" id="csw-view-create">
        <div class="csw-form">
          <div class="csw-form-group">
            <label class="csw-label">Assunto / Título *</label>
            <input type="text" id="csw-form-title" class="csw-input" placeholder="Ex: Erro ao emitir fatura" required>
          </div>
          <div class="csw-form-group">
            <label class="csw-label">Motivo do Contato *</label>
            <select id="csw-form-reason" class="csw-select">
              <option value="Suporte Técnico">Suporte Técnico</option>
              <option value="Dúvida">Dúvida / Questão</option>
              <option value="Financeiro">Financeiro / Cobrança</option>
              <option value="Sugestão">Sugestão / Melhoria</option>
              <option value="Outros">Outros</option>
            </select>
          </div>
          <div class="csw-form-group">
            <label class="csw-label">Descrição do Problema *</label>
            <textarea id="csw-form-description" class="csw-textarea" placeholder="Descreva detalhadamente como podemos te ajudar..." required></textarea>
          </div>
          <div class="csw-form-group">
            <label class="csw-label">Anexo (opcional)</label>
            <button type="button" class="csw-attach-btn" id="csw-form-attach-btn">
              <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
              Anexar foto, vídeo ou arquivo
            </button>
            <input type="file" id="csw-form-file-input" class="csw-hidden-file-input">
            <div id="csw-form-file-preview"></div>
          </div>
        </div>
        <div class="csw-footer">
          <button class="csw-btn" id="csw-btn-submit-ticket">Enviar Chamado</button>
        </div>
      </div>

      <!-- CHAT VIEW -->
      <div class="csw-view" id="csw-view-chat">
        <div class="csw-chat-ticket-bar" id="csw-chat-ticket-bar-root"></div>
        <div class="csw-chat-feed" id="csw-chat-feed-root"></div>
        <div id="csw-chat-file-preview"></div>
        <div class="csw-chat-input-panel">
          <input type="file" id="csw-chat-file-input" class="csw-hidden-file-input">
          <button class="csw-attach-icon-btn" id="csw-chat-attach-btn" title="Anexar arquivo">
            <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
          </button>
          <input type="text" id="csw-chat-text-input" class="csw-chat-input" placeholder="Digite sua mensagem...">
          <button class="csw-chat-send-btn" id="csw-chat-send-btn">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
    `;

    document.getElementById("csw-btn-new-ticket").addEventListener("click", () => changeView("create"));
    document.getElementById("csw-btn-submit-ticket").addEventListener("click", submitTicket);
    document.getElementById("csw-chat-send-btn").addEventListener("click", submitComment);
    document.getElementById("csw-chat-text-input").addEventListener("keypress", (e) => {
      if (e.key === "Enter") submitComment();
    });

    document.getElementById("csw-form-attach-btn").addEventListener("click", () => {
      document.getElementById("csw-form-file-input").click();
    });
    document.getElementById("csw-form-file-input").addEventListener("change", (e) => {
      pendingTicketFile = e.target.files[0] || null;
      renderFilePreview("csw-form-file-preview", pendingTicketFile, () => {
        pendingTicketFile = null;
        renderFilePreview("csw-form-file-preview", null);
      });
    });

    document.getElementById("csw-chat-attach-btn").addEventListener("click", () => {
      document.getElementById("csw-chat-file-input").click();
    });
    document.getElementById("csw-chat-file-input").addEventListener("change", (e) => {
      pendingChatFile = e.target.files[0] || null;
      renderFilePreview("csw-chat-file-preview", pendingChatFile, () => {
        pendingChatFile = null;
        renderFilePreview("csw-chat-file-preview", null);
      });
    });
  }

  // Renders a small "file selected" chip with a remove button above a form/input area.
  function renderFilePreview(containerId, file, onRemove) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!file) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = `
      <div class="csw-file-chip">
        <span class="csw-file-chip-name">${escapeHtml(file.name)}</span>
        <span class="csw-file-chip-size">${formatFileSize(file.size)}</span>
        <button type="button" class="csw-file-chip-remove" id="${containerId}-remove">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    `;
    document.getElementById(`${containerId}-remove`).addEventListener("click", onRemove);
  }

  function changeView(view) {
    activeView = view;
    
    // Hide/show views
    document.getElementById("csw-view-list").classList.toggle("active", view === "list");
    document.getElementById("csw-view-create").classList.toggle("active", view === "create");
    document.getElementById("csw-view-chat").classList.toggle("active", view === "chat");

    // Back button visibility
    const backBtn = document.getElementById("csw-btn-back");
    if (view === "list") {
      backBtn.style.display = "none";
      selectedTicketId = null;
    } else {
      backBtn.style.display = "flex";
    }

    if (view === "list") {
      renderTicketsList();
    }
  }

  async function loadTickets(silent = false) {
    const listRoot = document.getElementById("csw-ticket-list-root");
    if (!silent && tickets.length === 0) {
      listRoot.innerHTML = `<div class="csw-spinner"></div>`;
    }

    try {
      tickets = await apiCall("/api/public/widget/tickets");
      renderTicketsList();
    } catch (err) {
      console.error("CollabSupportWidget: Error loading tickets", err);
      if (!silent) {
        listRoot.innerHTML = `<div class="csw-empty-state"><div class="csw-empty-text">Falha ao carregar chamados.</div></div>`;
      }
    }
  }

  function renderTicketsList() {
    const listRoot = document.getElementById("csw-ticket-list-root");
    if (!listRoot) return;

    if (tickets.length === 0) {
      listRoot.innerHTML = `
        <div class="csw-empty-state">
          <svg class="csw-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div class="csw-empty-text">Nenhum chamado aberto</div>
          <div class="csw-empty-subtext">Precisa de ajuda? Crie um novo chamado abaixo.</div>
        </div>
      `;
      return;
    }

    const userName = session.user ? session.user.first_name : "";
    let html = `<div class="csw-user-welcome">Olá, ${userName}! Veja seus chamados:</div>`;

    tickets.forEach((ticket) => {
      const dateStr = formatRelativeTime(ticket.created_at);
      const statusBadge = `<span class="csw-badge csw-badge-${ticket.status}">${getStatusLabel(ticket.status)}</span>`;
      
      let lastComment = ticket.description || "Sem descrição.";
      if (ticket.activities && ticket.activities.length > 0) {
        const lastAct = ticket.activities[0];
        const prefix = lastAct.user_id === session.user.id ? "Você: " : `${lastAct.user?.first_name || "Suporte"}: `;
        lastComment = `${prefix}${lastAct.content}`;
      }

      html += `
        <div class="csw-ticket-card" data-id="${ticket.id}">
          <div class="csw-ticket-header">
            <h4 class="csw-ticket-title">${escapeHtml(ticket.title)}</h4>
            ${statusBadge}
          </div>
          <div>
            <span class="csw-ticket-reason">${escapeHtml(ticket.call_reason || "Geral")}</span>
          </div>
          <p class="csw-ticket-preview">${escapeHtml(lastComment)}</p>
          <div class="csw-ticket-meta">
            <span>Ticket #${ticket.id}</span>
            <span>${dateStr}</span>
          </div>
        </div>
      `;
    });

    listRoot.innerHTML = html;

    // Attach click listeners to cards
    const cards = listRoot.querySelectorAll(".csw-ticket-card");
    cards.forEach((card) => {
      card.addEventListener("click", () => {
        const ticketId = parseInt(card.getAttribute("data-id"), 10);
        openTicketChat(ticketId);
      });
    });
  }

  async function openTicketChat(ticketId) {
    selectedTicketId = ticketId;
    changeView("chat");

    const feedRoot = document.getElementById("csw-chat-feed-root");
    feedRoot.innerHTML = `<div class="csw-spinner"></div>`;

    const ticket = tickets.find((t) => t.id === ticketId);
    if (ticket) {
      document.getElementById("csw-chat-ticket-bar-root").innerHTML = `
        <div>
          <span style="font-weight:600; color:#0f172a;">Ticket #${ticket.id}</span>
          <span style="font-size:11px; margin-left: 6px;" class="csw-badge csw-badge-${ticket.status}">${getStatusLabel(ticket.status)}</span>
        </div>
        <div style="font-size:11px; color:#64748b;">${escapeHtml(ticket.call_reason)}</div>
      `;
    }

    await loadActivities(ticketId);
  }

  async function loadActivities(ticketId, silent = false) {
    try {
      activities = await apiCall(`/api/public/widget/tickets/${ticketId}/activities`);
      renderChatFeed(silent);
    } catch (err) {
      console.error("CollabSupportWidget: Error loading activities", err);
      if (!silent) {
        document.getElementById("csw-chat-feed-root").innerHTML = `
          <div class="csw-empty-state"><div class="csw-empty-text">Erro ao carregar mensagens.</div></div>
        `;
      }
    }
  }

  // Renders an image preview, video player, or file-download chip for a message's attachment.
  function renderAttachmentHtml(act) {
    if (!act.attachment_url) return "";
    const url = act.attachment_url;
    const type = act.attachment_type || "";
    const name = act.attachment_name || "Arquivo";

    if (type.startsWith("image/")) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="${escapeHtml(name)}" class="csw-msg-attachment-img"></a>`;
    }
    if (type.startsWith("video/")) {
      return `<video src="${url}" controls class="csw-msg-attachment-video"></video>`;
    }
    return `
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="csw-msg-attachment-file">
        <svg viewBox="0 0 24 24"><path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/></svg>
        <span class="csw-msg-attachment-name">${escapeHtml(name)}</span>
      </a>
    `;
  }

  function renderChatFeed(silent = false) {
    const feedRoot = document.getElementById("csw-chat-feed-root");
    if (!feedRoot) return;

    const ticket = tickets.find((t) => t.id === selectedTicketId);
    if (!ticket) return;

    let html = "";

    // Render the initial ticket description as the first message
    html += `
      <div class="csw-message-bubble csw-msg-right">
        <div class="csw-msg-sender">Você</div>
        <div>${escapeHtml(ticket.description)}</div>
        <span class="csw-msg-time">${new Date(ticket.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    `;

    activities.forEach((act) => {
      const isMyMessage = act.user_id === session.user.id;
      const bubbleClass = isMyMessage ? "csw-msg-right" : "csw-msg-left";
      const senderName = isMyMessage ? "Você" : (act.user?.first_name || "Suporte");
      const timeStr = new Date(act.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      html += `
        <div class="csw-message-bubble ${bubbleClass}">
          <div class="csw-msg-sender">${escapeHtml(senderName)}</div>
          ${act.content ? `<div>${escapeHtml(act.content)}</div>` : ""}
          ${renderAttachmentHtml(act)}
          <span class="csw-msg-time">${timeStr}</span>
        </div>
      `;
    });

    // Check if feed was scrolled near bottom before update
    const isNearBottom = feedRoot.scrollHeight - feedRoot.scrollTop - feedRoot.clientHeight < 80;

    feedRoot.innerHTML = html;

    if (!silent || isNearBottom) {
      feedRoot.scrollTop = feedRoot.scrollHeight;
    }
  }

  async function submitTicket() {
    const titleInput = document.getElementById("csw-form-title");
    const reasonInput = document.getElementById("csw-form-reason");
    const descInput = document.getElementById("csw-form-description");
    const submitBtn = document.getElementById("csw-btn-submit-ticket");

    const title = titleInput.value.trim();
    const call_reason = reasonInput.value;
    const description = descInput.value.trim();

    if (!title || !description) {
      alert("Por favor, preencha todos os campos obrigatórios.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = "Enviando...";

    try {
      const newTicket = await apiCall("/api/public/widget/tickets", "POST", {
        title,
        description,
        call_reason,
      });

      // If an attachment was selected on the opening form, send it as the ticket's first
      // chat message right after creation (tickets/activities is the single attachment pathway).
      if (pendingTicketFile) {
        try {
          const uploaded = await uploadWidgetAttachment(pendingTicketFile);
          await apiCall(`/api/public/widget/tickets/${newTicket.id}/activities`, "POST", {
            attachment_url: uploaded.url,
            attachment_name: uploaded.name,
            attachment_type: uploaded.type,
            attachment_size: uploaded.size,
          });
        } catch (attachErr) {
          console.error("CollabSupportWidget: Error uploading initial attachment", attachErr);
        }
        pendingTicketFile = null;
        renderFilePreview("csw-form-file-preview", null);
      }

      // Clear form
      titleInput.value = "";
      descInput.value = "";

      // Reload tickets and show chat
      await loadTickets(true);
      openTicketChat(newTicket.id);

    } catch (err) {
      console.error("CollabSupportWidget: Error submitting ticket", err);
      alert("Erro ao enviar chamado. Tente novamente.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = "Enviar Chamado";
    }
  }

  async function submitComment() {
    const input = document.getElementById("csw-chat-text-input");
    const sendBtn = document.getElementById("csw-chat-send-btn");
    const content = input.value.trim();
    const file = pendingChatFile;

    if ((!content && !file) || !selectedTicketId) return;

    input.value = "";
    input.focus();
    sendBtn.disabled = true;
    pendingChatFile = null;
    renderFilePreview("csw-chat-file-preview", null);

    try {
      let attachment = null;
      if (file) {
        attachment = await uploadWidgetAttachment(file);
      }

      const newComment = await apiCall(`/api/public/widget/tickets/${selectedTicketId}/activities`, "POST", {
        content,
        attachment_url: attachment?.url,
        attachment_name: attachment?.name,
        attachment_type: attachment?.type,
        attachment_size: attachment?.size,
      });

      // Append comment directly locally for instant response
      activities.push(newComment);
      renderChatFeed();
    } catch (err) {
      console.error("CollabSupportWidget: Error sending comment", err);
      alert("Erro ao enviar mensagem.");
    } finally {
      sendBtn.disabled = false;
    }
  }

  function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Export public interface
  window.CollabSupportWidget = {
    init: init,
  };
})();

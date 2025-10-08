document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("startCapture");
  const statusIndicator = document.getElementById("statusIndicator");
  const statusText = document.getElementById("statusText");
  const statusDescription = document.getElementById("statusDescription");
  const statusIcon = document.getElementById("statusIcon");
  const audioVisualizer = document.getElementById("audioVisualizer");
  const connectionStatus = document.getElementById("connectionStatus");
  const connectionText = document.getElementById("connectionText");

  let isStreaming = false;
  let socket = null;
  let currentStream = null;
  let audioContext = null;
  let processor = null;
  let currentToken = null;
  let tokenCheckInterval = null;

  // Configuration for backend Socket.IO
  const SOCKET_URL = "http://localhost:5000";
  const SOCKET_PATH = "/socket.io/";

  // ✅ Show waiting screen on load
  function showWaitingForToken() {
    updateStatus("waiting", "Waiting for Authentication", "Please login via web application first", "⏳");
    updateConnectionStatus("waiting", "Awaiting authentication token...");
    btn.disabled = true;
    btn.textContent = "Waiting for Login...";
    btn.className = "control-button disabled";
  }

  // ✅ Show ready screen when token received
  function showReadyToConnect() {
    updateStatus("idle", "Ready to Stream", "Click start to begin capturing audio", "🎤");
    updateConnectionStatus("disconnected", "Authenticated - Ready to connect");
    btn.disabled = false;
    btn.textContent = "Start Audio Streaming";
    btn.className = "control-button";
  }

  function updateStatus(status, text, description, icon) {
    statusIndicator.className = `status-indicator ${status}`;
    statusText.textContent = text;
    statusDescription.textContent = description;
    statusIcon.textContent = icon;
    
    if (status === "streaming") {
      audioVisualizer.classList.add("active");
    } else {
      audioVisualizer.classList.remove("active");
    }
  }

  function updateConnectionStatus(status, text) {
    connectionStatus.style.display = "flex";
    connectionStatus.className = `connection-status ${status}`;
    connectionText.textContent = text;
  }

  // ✅ Listen for token from main process
  if (window.electronAPI && window.electronAPI.onTokenReceived) {
    window.electronAPI.onTokenReceived((token) => {
      console.log('✅ Token received in renderer:', token.substring(0, 20) + '...');
      currentToken = token;
      
      // Stop checking for token
      if (tokenCheckInterval) {
        clearInterval(tokenCheckInterval);
        tokenCheckInterval = null;
      }
      
      // Show ready screen
      showReadyToConnect();
      
      // If socket already connected, reconnect with new token
      if (socket && socket.connected) {
        console.log('🔄 Reconnecting socket with new token...');
        stopStreaming();
      }
    });
  } else {
    console.error('❌ electronAPI not available - preload.js not configured correctly');
    updateStatus("error", "Configuration Error", "Electron API not available", "❌");
  }

  // ✅ Try to get token on page load
  async function checkForToken() {
    if (window.electronAPI && window.electronAPI.getToken) {
      try {
        const token = await window.electronAPI.getToken();
        if (token) {
          console.log('✅ Token retrieved on load:', token.substring(0, 20) + '...');
          currentToken = token;
          showReadyToConnect();
          return true;
        } else {
          console.log('⚠️ No token available yet. Waiting for web app login...');
          return false;
        }
      } catch (err) {
        console.warn('⚠️ Could not retrieve token:', err);
        return false;
      }
    } else {
      console.error('❌ electronAPI.getToken not available');
      return false;
    }
  }

  // ✅ Initialize - Check for token or show waiting screen
  (async function initialize() {
    const hasToken = await checkForToken();
    
    if (!hasToken) {
      showWaitingForToken();
      
      // ✅ Poll for token every 3 seconds
      tokenCheckInterval = setInterval(async () => {
        console.log('🔍 Checking for authentication token...');
        const tokenReceived = await checkForToken();
        if (tokenReceived) {
          clearInterval(tokenCheckInterval);
          tokenCheckInterval = null;
        }
      }, 3000);
    }
  })();

  btn.addEventListener("click", async () => {
    if (!isStreaming) {
      await startStreaming();
    } else {
      stopStreaming();
    }
  });

  async function startStreaming() {
    try {
      // ✅ CRITICAL - Check for token before any operation
      if (!currentToken) {
        console.log('⚠️ No token available. Attempting to retrieve...');
        
        if (window.electronAPI && window.electronAPI.getToken) {
          try {
            currentToken = await window.electronAPI.getToken();
          } catch (err) {
            console.error('❌ Failed to retrieve token:', err);
          }
        }
        
        if (!currentToken) {
          updateStatus("error", "Authentication Required", "Please login via web application first", "❌");
          updateConnectionStatus("disconnected", "No authentication token - login required");
          showWaitingForToken();
          return;
        }
      }

      updateStatus("connecting", "Connecting...", "Establishing connection to server", "🔄");
      updateConnectionStatus("connecting", "Connecting to server...");
      btn.disabled = true;

      // ✅ Request display media with error handling
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1, height: 1, frameRate: 0 },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            sampleRate: 16000
          }
        });
      } catch (mediaError) {
        console.error('❌ Media capture error:', mediaError);
        
        if (mediaError.name === 'NotAllowedError') {
          updateStatus("error", "Permission Denied", "Screen capture permission was denied", "❌");
          updateConnectionStatus("disconnected", "Permission denied");
        } else if (mediaError.name === 'NotFoundError') {
          updateStatus("error", "No Audio Source", "No audio source found", "❌");
          updateConnectionStatus("disconnected", "No audio source");
        } else {
          updateStatus("error", "Capture Failed", "Unable to capture system audio", "❌");
          updateConnectionStatus("disconnected", "Audio capture failed");
        }
        
        btn.disabled = false;
        return;
      }

      if (!stream || stream.getAudioTracks().length === 0) {
        updateStatus("error", "No Audio Track", "No audio track found in capture", "❌");
        updateConnectionStatus("disconnected", "No audio track available");
        btn.disabled = false;
        return;
      }

      currentStream = stream;

      // ✅ Create audio context with error handling
      try {
        audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);

        processor = audioContext.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(audioContext.destination);
      } catch (audioError) {
        console.error('❌ Audio context error:', audioError);
        updateStatus("error", "Audio Processing Error", "Failed to initialize audio processing", "❌");
        updateConnectionStatus("disconnected", "Audio initialization failed");
        
        // Clean up stream
        if (currentStream) {
          currentStream.getTracks().forEach((track) => track.stop());
          currentStream = null;
        }
        
        btn.disabled = false;
        return;
      }

      // ✅ Create Socket.IO connection WITH JWT token
      try {
        socket = io(SOCKET_URL, {
          path: SOCKET_PATH,
          transports: ["polling", "websocket"],
          auth: {
            token: currentToken
          },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5
        });
      } catch (socketError) {
        console.error('❌ Socket creation error:', socketError);
        updateStatus("error", "Connection Error", "Failed to create socket connection", "❌");
        updateConnectionStatus("disconnected", "Socket initialization failed");
        cleanupResources();
        btn.disabled = false;
        return;
      }

      socket.on("connect", () => {
        console.log("✅ Socket.IO connected with authentication");
        updateStatus("connected", "Connected", "Server connection established", "✅");
        updateConnectionStatus("connected", "Connected to server");

        setTimeout(() => {
          updateStatus("streaming", "Streaming Audio", "Streaming system audio to server", "🎵");
          updateConnectionStatus("connected", "Streaming active");
          isStreaming = true;
          btn.textContent = "Stop Streaming";
          btn.className = "control-button stop";
          btn.disabled = false;
        }, 1500);
      });

      socket.on("audio_result", (data) => {
        console.log("🎤 Server Response:", data);
      });

      socket.on("disconnect", (reason) => {
        console.warn("⚠️ Socket.IO disconnected. Reason:", reason);
        updateStatus("error", "Disconnected", "Lost connection to server", "⚠️");
        updateConnectionStatus("disconnected", `Server disconnected: ${reason}`);
        resetUI();
      });

      socket.on("connect_error", (error) => {
        console.error("❌ Connection Error:", error);
        
        // ✅ Check for authentication errors
        if (error.message && (error.message.includes('auth') || error.message.includes('Authentication'))) {
          updateStatus("error", "Authentication Failed", "Invalid or expired token", "❌");
          updateConnectionStatus("disconnected", "Auth failed - please re-login via web app");
          currentToken = null;
          showWaitingForToken();
        } else if (error.message && error.message.includes('timeout')) {
          updateStatus("error", "Connection Timeout", "Server did not respond", "❌");
          updateConnectionStatus("disconnected", "Connection timeout");
        } else {
          updateStatus("error", "Connection Error", "Cannot connect to server", "❌");
          updateConnectionStatus("disconnected", "Connection failed");
        }
        
        cleanupResources();
        resetUI();
      });

      // ✅ Audio processing with error handling
      processor.onaudioprocess = (e) => {
        try {
          if (!socket || !socket.connected) {
            return;
          }

          const input = e.inputBuffer.getChannelData(0);

          // Convert float [-1.0, 1.0] to Int16 PCM
          const int16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            let s = Math.max(-1, Math.min(1, input[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          socket.emit("agent_audio_chunk", int16.buffer);
        } catch (processingError) {
          console.error('❌ Audio processing error:', processingError);
        }
      };

    } catch (err) {
      console.error("❌ Unexpected error during streaming setup:", err);
      updateStatus("error", "Unexpected Error", err.message || "An unexpected error occurred", "❌");
      updateConnectionStatus("disconnected", "Error occurred");
      cleanupResources();
      resetUI();
    }
  }

  function cleanupResources() {
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }

    if (audioContext) {
      try {
        audioContext.close();
      } catch (e) {
        console.warn('Error closing audio context:', e);
      }
      audioContext = null;
    }

    if (processor) {
      try {
        processor.disconnect();
      } catch (e) {
        console.warn('Error disconnecting processor:', e);
      }
      processor = null;
    }
  }

  function stopStreaming() {
    if (socket) {
      try {
        socket.disconnect();
      } catch (e) {
        console.warn('Error disconnecting socket:', e);
      }
      socket = null;
    }

    cleanupResources();

    updateStatus("idle", "Stopped", "Audio streaming stopped", "🛑");
    updateConnectionStatus("disconnected", "Streaming stopped");
    resetUI();
  }

  function resetUI() {
    isStreaming = false;
    
    if (currentToken) {
      btn.textContent = "Start Audio Streaming";
      btn.className = "control-button";
      btn.disabled = false;
    } else {
      showWaitingForToken();
    }
  }

  // ✅ Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (tokenCheckInterval) {
      clearInterval(tokenCheckInterval);
    }
    stopStreaming();
  });
});

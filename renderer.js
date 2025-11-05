document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("startCapture");
  const statusIndicator = document.getElementById("statusIndicator");
  const statusText = document.getElementById("statusText");
  const statusDescription = document.getElementById("statusDescription");
  const statusIcon = document.getElementById("statusIcon");
  const audioVisualizer = document.getElementById("audioVisualizer");
  const connectionStatus = document.getElementById("connectionStatus");
  const connectionText = document.getElementById("connectionText");
  const selectSystemAudio = document.getElementById("selectSystemAudio");
  const testPlayback = document.getElementById("testPlayback");
  const systemAudioStatus = document.getElementById("systemAudioStatus");
  const playbackStatus = document.getElementById("playbackStatus");
  const volumeBar = document.getElementById("volumeBar");

  let isStreaming = false;
  let socket = null;
  let currentStream = null;
  let audioContext = null;
  let processor = null;

  // Configuration for backend Socket.IO
// const SOCKET_URL = "https://wipgenai.lwpcoe.com";
// const SOCKET_PATH = "/vqa_live_v2/socket.io/";

const SOCKET_URL = "http://localhost:5000";
const SOCKET_PATH = "/socket.io/";

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

  btn.addEventListener("click", async () => {
    if (!isStreaming) {
      startStreaming();
    } else {
      stopStreaming();
    }
  });

  async function startStreaming() {
    try {
      updateStatus("connecting", "Connecting...", "Establishing connection to server", "🔄");
      updateConnectionStatus("connecting", "Connecting to server...");
      btn.disabled = true;

      // Request display media with minimal video - mandatory for getDisplayMedia
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 0 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 16000
        }
      });

      if (!stream || stream.getAudioTracks().length === 0) {
        updateStatus("error", "Capture Failed", "Unable to capture system audio", "❌");
        updateConnectionStatus("disconnected", "Audio capture failed");
        btn.disabled = false;
        return;
      }

      currentStream = stream;
      audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);

      processor = audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination); // process audio buffer events

      socket = io(SOCKET_URL, {
        path: SOCKET_PATH,
        transports: ["polling", "websocket"]
      });

      socket.on("connect", () => {
        console.log("✅ Socket.IO connected to server");
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

      socket.on("disconnect", () => {
        console.warn("⚠️ Socket.IO disconnected");
        updateStatus("error", "Disconnected", "Lost connection to server", "⚠️");
        updateConnectionStatus("disconnected", "Server disconnected");
        resetUI();
      });

      socket.on("connect_error", (error) => {
        console.error("❌ Connection Error:", error);
        updateStatus("error", "Connection Error", "Cannot connect to server", "❌");
        updateConnectionStatus("disconnected", "Connection failed");
        resetUI();
      });

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);

        // Convert float [-1.0, 1.0] to Int16 PCM
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          let s = Math.max(-1, Math.min(1, input[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        if (socket && socket.connected) {
          socket.emit("audio_chunk", int16.buffer);
        }
      };
    } catch (err) {
      console.error("Error during streaming setup:", err);
      updateStatus("error", "Error", "An unexpected error occurred", "❌");
      updateConnectionStatus("disconnected", "Error occurred");
      resetUI();
    }
  }

  function stopStreaming() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }

    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      currentStream = null;
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    if (processor) {
      processor.disconnect();
      processor = null;
    }

    updateStatus("idle", "Stopped", "Audio streaming stopped", "🛑");
    updateConnectionStatus("disconnected", "Streaming stopped");
    resetUI();
  }

  function resetUI() {
    isStreaming = false;
    btn.textContent = "Start Audio Streaming";
    btn.className = "control-button";
    btn.disabled = false;
  }

  // Initialize
  updateStatus("idle", "Ready to Stream", "Click start to begin capturing audio", "🎤");
});

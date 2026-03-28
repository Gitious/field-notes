import { useRef, useState, useCallback, useEffect } from "react";
import type { Observation } from "../lib/api";
import { ObservationCard } from "../components/ObservationCard";

// ─── Audio helpers ───

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

function downsample(buf: Float32Array, from: number, to: number): Int16Array {
  const ratio = from / to;
  const out = new Int16Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(buf[Math.floor(i * ratio)] * 32768)));
  }
  return out;
}

export function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "active" | "error">("idle");
  const [observations, setObservations] = useState<Observation[]>([]);
  const [sessionId] = useState(`session_${Date.now()}`);
  const [frameCount, setFrameCount] = useState(0);
  const [debugMsg, setDebugMsg] = useState("");
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [lastObs, setLastObs] = useState<string>("");

  // ─── Audio playback ───
  const playNext = useCallback(() => {
    const ctx = playbackCtxRef.current;
    if (!ctx || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsAiSpeaking(false);
      return;
    }
    isPlayingRef.current = true;
    setIsAiSpeaking(true);
    const samples = audioQueueRef.current.shift()!;
    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => playNext();
    src.start();
  }, []);

  const queueAudio = useCallback((b64: string) => {
    audioQueueRef.current.push(base64ToFloat32(b64));
    if (!isPlayingRef.current) playNext();
  }, [playNext]);

  // Observations now come from Gemini function calling via WebSocket (no REST polling needed)

  // ─── Cleanup ───
  const cleanup = useCallback(() => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (playbackCtxRef.current) { playbackCtxRef.current.close().catch(() => {}); playbackCtxRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // ─── Start ───
  const startStreaming = useCallback(async () => {
    try {
      setStatus("connecting");
      setDebugMsg("Starting camera & mic...");

      // Camera + mic
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      // Audio contexts
      const audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      audioCtxRef.current = audioCtx;

      const playbackCtx = new AudioContext({ sampleRate: 24000 });
      if (playbackCtx.state === "suspended") await playbackCtx.resume();
      playbackCtxRef.current = playbackCtx;

      // Mic capture
      const micSource = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      micSource.connect(processor);
      processor.connect(audioCtx.destination);

      // Connect to OUR backend WebSocket (which relays to Gemini)
      setDebugMsg("Connecting to server...");
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/live?mode=camera&session=${sessionId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setDebugMsg("Connected — waiting for Gemini...");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "ready") {
            setStatus("active");
            setIsStreaming(true);
            setDebugMsg("Live — speak or point camera");

            // Start sending mic audio
            processor.onaudioprocess = (e) => {
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
              const pcm = downsample(e.inputBuffer.getChannelData(0), audioCtx.sampleRate, 16000);
              wsRef.current.send(JSON.stringify({ type: "audio", data: int16ToBase64(pcm) }));
            };

            // Send video frames at 1fps
            frameIntervalRef.current = setInterval(() => {
              const video = videoRef.current;
              const canvas = canvasRef.current;
              if (!video || !canvas || video.readyState < 2) return;
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
              canvas.width = 640;
              canvas.height = 480;
              const ctx = canvas.getContext("2d");
              if (!ctx) return;
              ctx.drawImage(video, 0, 0, 640, 480);
              const b64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
              wsRef.current.send(JSON.stringify({ type: "video", data: b64 }));
              setFrameCount((c) => c + 1);
            }, 1000);

            // Observations now come via Gemini function calling (log_observation tool)
            return;
          }

          if (msg.type === "audio") {
            queueAudio(msg.data);
          }

          // Observation from Gemini function calling
          if (msg.type === "new_observation" && msg.observation) {
            setObservations((prev) => [msg.observation, ...prev]);
            setLastObs(msg.observation.visual_description?.slice(0, 80) || "New observation");
            setTimeout(() => setLastObs(""), 5000);
          }

          if (msg.type === "turn_complete") {
            // Audio queue will finish naturally
          }

          if (msg.type === "error") {
            setDebugMsg(`Gemini: ${msg.error}`);
          }

          if (msg.type === "gemini_closed") {
            setDebugMsg(`Gemini disconnected (${msg.code}). Tap Start to reconnect.`);
            setStatus("error");
            setIsStreaming(false);
          }
        } catch {}
      };

      ws.onerror = () => {
        setStatus("error");
        setDebugMsg("Connection error");
      };

      ws.onclose = () => {
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
        if (processorRef.current) processorRef.current.onaudioprocess = null;
        setIsStreaming(false);
        if (status === "active") {
          setStatus("error");
          setDebugMsg("Disconnected. Tap Start to reconnect.");
        }
      };
    } catch (err) {
      setStatus("error");
      setDebugMsg(`${err}`);
    }
  }, [sessionId, queueAudio, playNext, status, cleanup]);

  const stopStreaming = useCallback(() => {
    cleanup();
    setIsStreaming(false);
    setStatus("idle");
    setDebugMsg("");
    setIsAiSpeaking(false);
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  const colors: Record<string, string> = {
    idle: "bg-gray-500",
    connecting: "bg-yellow-500 animate-pulse",
    active: "bg-green-500 animate-pulse",
    error: "bg-red-500",
  };
  const labels: Record<string, string> = {
    idle: "Ready",
    connecting: "Connecting...",
    active: `Live (${frameCount} frames)`,
    error: "Error",
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <div className="relative flex-shrink-0">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-[50vh] object-cover bg-gray-900" />
        <canvas ref={canvasRef} className="hidden" />

        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm">
            <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
            <span className="text-xs font-medium">{labels[status]}</span>
          </div>
          <div className="flex items-center gap-2">
            {isAiSpeaking && (
              <div className="px-2 py-1 rounded-full bg-purple-500/30 border border-purple-500/50 text-[10px] text-purple-300 animate-pulse">
                AI speaking
              </div>
            )}
            <span className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-xs">{observations.length} obs</span>
          </div>
        </div>

        {debugMsg && (
          <div className="absolute bottom-14 left-4 right-4">
            <div className="px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm text-[10px] text-gray-400 font-mono truncate">{debugMsg}</div>
          </div>
        )}

        {lastObs && (
          <div className="absolute bottom-28 left-4 right-4 animate-pulse">
            <div className="px-3 py-2 rounded-lg bg-green-500/20 border border-green-500/40 text-xs text-green-300">
              New: {lastObs}
            </div>
          </div>
        )}

        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <button
            onClick={isStreaming ? stopStreaming : startStreaming}
            className={`px-8 py-3 rounded-full font-semibold text-sm shadow-lg transition-all ${
              isStreaming ? "bg-red-500 hover:bg-red-600 text-white" : "bg-white hover:bg-gray-100 text-black"
            }`}
          >
            {isStreaming ? "Stop" : "Start Observing"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Live Observations</h2>
          {observations.length > 0 && <span className="text-xs text-gray-500">Session: {sessionId.slice(-8)}</span>}
        </div>
        {observations.length === 0 ? (
          <div className="text-center py-8 text-gray-600">
            <p className="text-sm">No observations yet</p>
            <p className="text-xs mt-1">{isStreaming ? "AI is watching & listening..." : "Tap Start Observing to begin"}</p>
          </div>
        ) : (
          observations.map((obs) => <ObservationCard key={obs.id} observation={obs} compact />)
        )}
      </div>

      <div className="flex-shrink-0 border-t border-white/10 p-3 flex justify-center">
        <a href="/dashboard" className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Dashboard
        </a>
      </div>
    </div>
  );
}

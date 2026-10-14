// Auravia transcription worker. Models run off the UI thread.
// Transformers.js v3.7.2 is pinned to avoid surprise CDN upgrades.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.proxy = false;

let asrPipeline = null;
let loadedModel = "";

const send = (data) => self.postMessage(data);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

self.onmessage = async ({data}) => {
  if (data.type !== "transcribe") return;
  try {
    const {audio, sampleRate, model, language, style, translate, speakers} = data;
    if (!(audio instanceof Float32Array) || sampleRate !== 16000) {
      throw new Error("Audio preparation failed. Expected mono Float32 audio resampled to 16 kHz.");
    }
    if (data.duration > 900) throw new Error("This file is longer than 15 minutes. Please trim it into shorter recordings.");
    if (speakers) send({type:"status", percent:0, title:"One limitation to know", message:"Speaker diarization is not available in this browser build. Whisper transcription will continue without automatic speaker labels.", label:"Speaker detection"});
    if (!asrPipeline || loadedModel !== model) {
      send({type:"status", percent:0, title:"Preparing the listening room…", message:"Loading the open-source Whisper model. The first download can take a while.", label:"Model download"});
      asrPipeline = await pipeline("automatic-speech-recognition", model, {
        device: await chooseDevice(),
        dtype: "q8",
        progress_callback: (p) => {
          if (p.status === "progress") {
            send({type:"download", progress: p.progress || 0, file: p.file || "", status: p.status});
          } else if (p.status === "done") {
            send({type:"download", progress:100, file:p.file || "", status:"done"});
          } else if (p.status === "initiate" || p.status === "download") {
            send({type:"status", percent:0, title:"Preparing the listening room…", message:`${p.status === "initiate" ? "Starting" : "Downloading"} model files from the CDN.`, label:"Model download"});
          }
        }
      });
      loadedModel = model;
    }
    send({type:"status", percent:2, title:"Listening to the stars…", message:"Whisper is listening to your recording in chunks.", label:"Transcription"});
    // Whisper's chunked ASR pipeline handles long recordings without passing the full
    // recording through the model in one inference window.
    const opts = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: translate ? "translate" : "transcribe"
    };
    if (language && language !== "auto") opts.language = language;
    // Prompting is best-effort only; generation support varies by Transformers.js model.
    if (style === "full") opts.prompt = "Umm, uh, so, like, you know, I mean, well...";
    const result = await asrPipeline(audio, {
      ...opts,
      callback_function: (chunks) => {
        // Chunk callback shape varies by pipeline version; treat this as a best-effort update.
        if (Array.isArray(chunks) && chunks.length) {
          const pct = clamp((chunks.length * 30 / Math.max(1, data.duration))*100, 3, 95);
          send({type:"progress", percent:pct, message:"Writing your words…"});
        }
      }
    });
    let chunks = result.chunks || [];
    if (!chunks.length && result.text) chunks = [{text:result.text, timestamp:[0, data.duration]}];
    const segments = chunks.map((c, i) => {
      const ts = Array.isArray(c.timestamp) ? c.timestamp : [null, null];
      return {
        start: Number.isFinite(ts[0]) ? ts[0] : (i ? chunks[i-1].timestamp?.[1] || 0 : 0),
        end: Number.isFinite(ts[1]) ? ts[1] : Math.min(data.duration, (i+1)*30),
        text: (c.text || "").trim(),
        speaker: ""
      };
    }).filter(s => s.text);
    if (!segments.length && result.text) segments.push({start:0,end:data.duration,text:result.text.trim(),speaker:""});
    send({
      type:"progress", percent:99, message:"Almost there…"
    });
    send({
      type:"result", segments, device: "Whisper · local browser inference",
      note: speakers
        ? "Transcript ready. Automatic speaker diarization is not available in this build, so speaker labels were not generated. You can edit text manually."
        : (style === "full"
          ? "Transcript ready. The prompt may encourage fillers, but Whisper can still omit or normalize disfluencies."
          : "Transcript ready. Clean verbatim removes common English fillers after transcription; this may occasionally remove a word you wanted to keep.")
    });
  } catch (err) {
    let message = err?.message || String(err);
    if (/out of memory|memory allocation|wasm memory|allocation failed/i.test(message)) {
      message = "Auravia ran out of available memory. Try the Tiny model, close other tabs, or split the recording into shorter files.";
    } else if (/unsupported|not supported|decode/i.test(message)) {
      message = `This audio could not be processed: ${message}`;
    }
    send({type:"error", message});
  }
};

async function chooseDevice() {
  try {
    if (typeof navigator !== "undefined" && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch (_) {}
  return "wasm";
}

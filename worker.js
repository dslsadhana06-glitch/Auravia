// Auravia transcription worker (v2). Models run off the UI thread.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

env.allowLocalModels = false;
env.useBrowserCache = true;

const SLICE_SECONDS = 30;
const RATE = 16000;
const isMobile = /Android|iPhone|iPad|Mobile/i.test((self.navigator && self.navigator.userAgent) || "");

let asr = null;
let loadedModel = "";
let loadedDevice = "";

const send = (data) => self.postMessage(data);

function onDownload(p) {
  if (p.status === "progress") {
    send({type: "download", progress: p.progress || 0, file: p.file || "", status: p.status});
  } else if (p.status === "done") {
    send({type: "download", progress: 100, file: p.file || "", status: "done"});
  } else if (p.status === "initiate" || p.status === "download") {
    send({type: "status", percent: 0, title: "Preparing the listening room…", message: "Downloading model files. The first time can take a few minutes.", label: "Model download"});
  }
}

async function loadModel(model) {
  if (asr && loadedModel === model) return;
  asr = null;
  if (!isMobile && self.navigator && self.navigator.gpu) {
    try {
      const adapter = await self.navigator.gpu.requestAdapter();
      if (adapter) {
        asr = await pipeline("automatic-speech-recognition", model, {
          device: "webgpu",
          dtype: {encoder_model: "fp32", decoder_model_merged: "q4"},
          progress_callback: onDownload
        });
        loadedDevice = "WebGPU";
      }
    } catch (e) {
      asr = null;
    }
  }
  if (!asr) {
    asr = await pipeline("automatic-speech-recognition", model, {
      device: "wasm",
      dtype: "q8",
      progress_callback: onDownload
    });
    loadedDevice = "WASM";
  }
  loadedModel = model;
}

self.onmessage = async ({data}) => {
  if (data.type !== "transcribe") return;
  try {
    const {audio, sampleRate, model, language, style, translate, speakers, duration} = data;
    if (!(audio instanceof Float32Array) || sampleRate !== RATE) {
      throw new Error("Audio preparation failed. Expected mono Float32 audio at 16 kHz.");
    }
    if (duration > 900) throw new Error("This file is longer than 15 minutes. Please trim it into shorter recordings.");

    send({type: "status", percent: 0, title: "Preparing the listening room…", message: "Loading the Whisper model.", label: "Model setup"});
    await loadModel(model);

    const sliceLen = SLICE_SECONDS * RATE;
    const total = Math.max(1, Math.ceil(audio.length / sliceLen));
    const opts = {task: translate ? "translate" : "transcribe", return_timestamps: true};
    if (language && language !== "auto") opts.language = language;

    send({type: "progress", percent: 3, message: `Starting (${loadedDevice} mode). Part 1 of ${total}…`});

    const segments = [];
    for (let i = 0; i < total; i++) {
      const from = i * sliceLen;
      const slice = audio.subarray(from, Math.min(audio.length, from + sliceLen));
      const offset = i * SLICE_SECONDS;
      const sliceDur = slice.length / RATE;
      send({type: "progress", percent: 3 + (i / total) * 92, message: `Listening to part ${i + 1} of ${total}…`});
      if (slice.length < RATE) continue;

      const out = await asr(slice, opts);
      let chunks = Array.isArray(out.chunks) ? out.chunks : [];
      if (!chunks.length && out.text) chunks = [{text: out.text, timestamp: [0, sliceDur]}];
      for (const c of chunks) {
        const text = (c.text || "").trim();
        if (!text) continue;
        const ts = Array.isArray(c.timestamp) ? c.timestamp : [0, sliceDur];
        const s = Number.isFinite(ts[0]) ? ts[0] : 0;
        const e = Number.isFinite(ts[1]) ? ts[1] : sliceDur;
        segments.push({start: offset + s, end: offset + e, text, speaker: ""});
      }
    }

    send({type: "progress", percent: 99, message: "Almost there…"});
    send({
      type: "result",
      segments,
      device: `Whisper · ${loadedDevice}`,
      note: speakers
        ? "Transcript ready. Automatic speaker labels are not available in this build. You can edit the text manually."
        : (style === "full"
          ? "Transcript ready. Whisper may still skip or tidy fillers even in full verbatim."
          : "Transcript ready. Clean verbatim removes common English fillers after transcription.")
    });
  } catch (err) {
    let message = (err && err.message) || String(err);
    if (/out of memory|memory allocation|wasm memory|allocation failed/i.test(message)) {
      message = "Auravia ran out of memory. Try the Tiny model, close other tabs, or use a shorter file.";
    }
    send({type: "error", message});
  }
};

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput"), dropZone = $("dropZone"), transcribeBtn = $("transcribeBtn");
let selectedFile = null, audioBuffer = null, worker = null, currentSegments = [], transcriptRows = [], modelReady = false;
const supportedExtensions = /\.(mp3|wav|m4a|ogg|mp4)$/i;

function show(el, yes = true) { el.hidden = !yes; }
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "Duration unavailable";
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")} (${Math.round(seconds)} seconds)`;
}
function setFileError(message) { $("fileError").textContent = message; show($("fileError"), !!message); }
function resetFile() {
  selectedFile = null; audioBuffer = null; fileInput.value = "";
  show($("fileMeta"), false); show($("durationWarning"), false); setFileError("");
  $("dropTitle").textContent = "Drop your file into the orbit";
  transcribeBtn.disabled = true;
}
function handleFile(file) {
  if (!file) return;
  setFileError("");
  if (!supportedExtensions.test(file.name) && !/^audio\//i.test(file.type) && !/^video\/mp4$/i.test(file.type)) {
    resetFile(); setFileError("That file type is not supported. Please choose MP3, WAV, M4A, OGG, or MP4."); return;
  }
  selectedFile = file;
  $("fileName").textContent = file.name;
  $("fileDuration").textContent = "Reading duration…";
  $("dropTitle").textContent = "Your recording is in orbit";
  show($("fileMeta")); show($("durationWarning"), false); transcribeBtn.disabled = true;
  const url = URL.createObjectURL(file);
  const media = document.createElement("audio");
  media.preload = "metadata";
  media.onloadedmetadata = () => {
    const duration = media.duration;
    $("fileDuration").textContent = formatDuration(duration);
    if (duration > 900) {
      $("durationWarning").textContent = "This recording is longer than 15 minutes. Auravia may run out of memory or take a long time; consider trimming it into shorter files.";
      show($("durationWarning"));
    } else if (duration < 180) {
      $("durationWarning").textContent = "This recording is under 3 minutes. Auravia can still transcribe it, though the guided workflow is designed for recordings of 3–15 minutes.";
      show($("durationWarning"));
    }
    URL.revokeObjectURL(url);
    transcribeBtn.disabled = !Number.isFinite(duration) || duration <= 0;
  };
  media.onerror = () => {
    URL.revokeObjectURL(url);
    $("fileDuration").textContent = "Duration could not be read";
    setFileError("The browser could not read this file's media metadata. Try WAV or MP3, or another browser.");
    transcribeBtn.disabled = true;
  };
  media.src = url;
}
dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
$("removeFile").addEventListener("click", resetFile);
["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.add("drag-over"); }));
["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.remove("drag-over"); }));
dropZone.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));

$("themeToggle").addEventListener("click", () => {
  const light = document.documentElement.dataset.theme !== "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  $("themeToggle").setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
  $("themeIcon").textContent = light ? "☾" : "☼";
  document.querySelector(".theme-label").textContent = light ? "Night mode" : "Dawn mode";
});

$("speakers").addEventListener("change", () => show($("speakerNotice"), $("speakers").checked));
function setProgress(percent, title, message, label) {
  const p = Math.max(0, Math.min(100, percent || 0));
  $("progressBar").style.width = `${p}%`; $("progressPercent").textContent = `${Math.round(p)}%`;
  if (title) $("progressTitle").textContent = title;
  if (message) $("progressMessage").textContent = message;
  if (label) $("progressLabel").textContent = label;
}
function cleanText(text, language) {
  if (language !== "english" && language !== "auto") return text;
  return text
    .replace(/\b(?:um+|uh+|erm+|er+|you know|i mean|sort of|kind of)\b[, ]*/gi, "")
    .replace(/\b(\w+)(\s+\1\b){1,}/gi, "$1")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?])\s*([a-z])/g, (_, p, c) => `${p} ${c.toUpperCase()}`)
    .replace(/\s{2,}/g, " ").trim();
}
function timestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `[${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}]`;
}
function renderSegments(segments) {
  const withTimes = $("timestamps").checked;
  return segments.map(s => `${withTimes ? timestamp(s.start) + " " : ""}${s.speaker ? s.speaker + ": " : ""}${s.text}`.trim()).join("\n");
}
function makeWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./worker.js", import.meta.url), {type:"module"});
  worker.onmessage = async ({data}) => {
    if (data.type === "status") {
      setProgress(data.percent ?? 0, data.title, data.message, data.label);
    } else if (data.type === "download") {
      const pct = data.progress ?? 0;
      setProgress(pct, "Preparing the listening room…", data.file ? `Downloading model file: ${data.file}` : "Downloading Whisper model files.", "Model download");
    } else if (data.type === "progress") {
      setProgress(data.percent ?? 0, "Listening to the stars…", data.message || "Writing your words…", "Transcription");
    } else if (data.type === "result") {
      currentSegments = data.segments || [];
      const lang = $("language").value;
      if (document.querySelector('input[name="style"]:checked').value === "clean") {
        currentSegments = currentSegments.map(s => ({...s, text: cleanText(s.text, lang)})).filter(s => s.text);
      }
      transcriptRows = currentSegments.map(s => ({...s}));
      $("transcript").value = renderSegments(transcriptRows);
      $("resultStats").textContent = `${transcriptRows.length} segments · ${data.device || "local inference"}`;
      show($("resultCard")); show($("progressCard"), false);
      $("exportMessage").textContent = data.note || "Ready. Review and edit the transcript before exporting.";
      $("speakerRenameArea").hidden = true;
      $("resultCard").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto":"smooth", block:"start"});
      transcribeBtn.disabled = false; modelReady = true;
    } else if (data.type === "error") {
      show($("processError")); $("processError").textContent = data.message;
      setProgress(0, "A small pause in the stars", "Please check the message below and try again.", "Stopped");
      transcribeBtn.disabled = false;
    }
  };
  worker.onerror = (e) => {
    show($("processError")); $("processError").textContent = `Worker error: ${e.message || "The transcription worker stopped unexpectedly."}`;
    transcribeBtn.disabled = false;
  };
  return worker;
}
async function decodeAndResample(file) {
  let ctx;
  try {
    const bytes = await file.arrayBuffer();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(bytes);
    const duration = decoded.duration;
    if (duration > 900) throw new Error("too-long");
    if (duration > 900) throw new Error("too-long");
    const targetRate = 16000;
    const mono = new Float32Array(decoded.length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const channel = decoded.getChannelData(ch);
      for (let i = 0; i < channel.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
    }
    if (decoded.sampleRate === targetRate) return {audio: mono, duration, sampleRate: targetRate};
    const outputLength = Math.ceil(mono.length * targetRate / decoded.sampleRate);
    const offline = new OfflineAudioContext(1, outputLength, targetRate);
    const buffer = offline.createBuffer(1, mono.length, decoded.sampleRate);
    buffer.copyToChannel(mono, 0);
    const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start(0);
    const rendered = await offline.startRendering();
    return {audio: rendered.getChannelData(0).slice(), duration, sampleRate: targetRate};
  } catch (err) {
    if (err.message === "too-long") throw new Error("This file is longer than 15 minutes. Please trim it into shorter recordings to avoid memory problems.");
    if (err.name === "NotSupportedError" || /decode|supported|encoding/i.test(err.message || "")) throw new Error("This browser cannot decode this file. Try converting it to WAV or MP3, or use a browser with support for this media codec.");
    if (err.name === "RangeError" || /memory|allocation/i.test(err.message || "")) throw new Error("This recording is too large for available memory. Try a shorter file or the Tiny model.");
    throw new Error(`Could not read the audio: ${err.message || "unknown file or audio error"}`);
  } finally { if (ctx && ctx.state !== "closed") await ctx.close().catch(()=>{}); }
}
transcribeBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  transcribeBtn.disabled = true; show($("processError"), false); show($("resultCard"), false); show($("progressCard"));
  setProgress(0, "Preparing your audio…", "Carefully opening your recording.", "Audio preparation");
  $("engineNote").textContent = "Model files are downloaded from the jsDelivr CDN on first use and may be cached by your browser.";
  try {
    const decoded = await decodeAndResample(selectedFile);
    setProgress(0, "Calling the constellations…", "Loading Whisper in a background worker.", "Model setup");
    const w = makeWorker();
    const style = document.querySelector('input[name="style"]:checked').value;
    w.postMessage({
      type:"transcribe", audio:decoded.audio, duration:decoded.duration, sampleRate:decoded.sampleRate,
      model:$("model").value, language:$("language").value, style,
      translate:$("translate").checked, timestamps:$("timestamps").checked,
      speakers:$("speakers").checked
    }, [decoded.audio.buffer]);
  } catch (err) {
    show($("processError")); $("processError").textContent = err.message || "An unexpected audio processing error occurred.";
    transcribeBtn.disabled = false;
  }
});
function downloadFile(name, content, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function currentEditedText() { return $("transcript").value.trim(); }
$("copyBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(currentEditedText()); $("exportMessage").textContent = "Copied to clipboard."; }
  catch { $("transcript").select(); const ok = document.execCommand("copy"); $("exportMessage").textContent = ok ? "Copied to clipboard." : "Clipboard access was blocked. Select and copy the transcript manually."; }
});
$("txtBtn").addEventListener("click", () => downloadFile("Auravia_transcript.txt", currentEditedText(), "text/plain;charset=utf-8"));
function timeSrt(sec, comma) {
  const ms = Math.floor(Math.max(0,sec)*1000), h=Math.floor(ms/3600000), m=Math.floor(ms%3600000/60000), s=Math.floor(ms%60000/1000), milli=ms%1000;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}${comma ? "," : "."}${String(milli).padStart(3,"0")}`;
}
function exportTimed(format) {
  const timed = transcriptRows.length ? transcriptRows : [];
  if (!timed.length) { $("exportMessage").textContent = "No segment timing is available. Export TXT for your edited text."; return; }
  const vtt = format === "vtt";
  const lines = timed.map((s,i) => `${vtt ? "" : `${i+1}\n`}${timeSrt(s.start, !vtt)} --> ${timeSrt(s.end, !vtt)}\n${s.speaker ? s.speaker + ": " : ""}${s.text}`).join("\n\n");
  downloadFile(vtt ? "Auravia_transcript.vtt" : "Auravia_transcript.srt", (vtt ? "WEBVTT\n\n" : "") + lines, vtt ? "text/vtt;charset=utf-8" : "application/x-subrip;charset=utf-8");
  $("exportMessage").textContent = "Exported timed segments. Note: SRT/VTT use model segment timing, even if timestamps are hidden in the editor.";
}
$("srtBtn").addEventListener("click", () => exportTimed("srt"));
$("vttBtn").addEventListener("click", () => exportTimed("vtt"));

// Lightweight animated starfield; pauses when tab is hidden and respects reduced motion.
(() => {
  const canvas = $("starfield"), ctx = canvas.getContext("2d");
  if (!ctx || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let stars = [], raf = 0, last = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(innerWidth*dpr); canvas.height = Math.floor(innerHeight*dpr);
    canvas.style.width = innerWidth+"px"; canvas.style.height = innerHeight+"px"; ctx.setTransform(dpr,0,0,dpr,0,0);
    stars = Array.from({length:Math.min(230,Math.floor(innerWidth*innerHeight/5500))},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,r:.3+Math.random()*1.1,a:.18+Math.random()*.62,phase:Math.random()*6.28,speed:.15+Math.random()*.45}));
  }
  function draw(t) {
    if (document.hidden) { raf=0; return; }
    if (t-last>45) {
      last=t; ctx.clearRect(0,0,innerWidth,innerHeight);
      for (const s of stars) {
        const alpha=s.a*(.72+.28*Math.sin(t*.001*s.speed+s.phase));
        ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fillStyle=`rgba(231,224,255,${alpha})`;ctx.fill();
      }
    }
    raf=requestAnimationFrame(draw);
  }
  function start(){if(!raf&&!document.hidden)raf=requestAnimationFrame(draw)}
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0}
  addEventListener("resize",resize);document.addEventListener("visibilitychange",()=>document.hidden?stop():start());resize();start();
})();

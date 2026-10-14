# Auravia

A static, client-side transcription web app using Transformers.js `3.7.2` and Xenova Whisper models.

## Run locally
Because ES modules and model workers should be served over HTTP, don't open `index.html` directly from the file system. In the project directory, run one of:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages for free
1. Create a GitHub repository, for example `auravia`.
2. Upload `index.html`, `app.js`, `worker.js`, and `style.css` to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Select branch `main` and folder `/ (root)`, then Save.
6. Wait for GitHub Pages to publish the site. Open the published URL over HTTPS.
7. On first use, select a file and wait while Whisper model files download from jsDelivr. A stable internet connection is required for the first download.

Netlify and Cloudflare Pages can also host the same static files without a backend.

## Privacy and costs
No application backend, API key, or paid API is used. Audio decoding and inference are performed in the browser. Model files are fetched from jsDelivr and Hugging Face model hosting as required by Transformers.js. The browser may cache model assets. Your recording is not uploaded by this app's code, but hosting/CDN providers can see requests for static model assets.

## Known limitations
- Automatic speaker diarization is not implemented. The UI explains this when speaker labels are selected. The commonly used pyannote diarization models are not a drop-in Transformers.js browser pipeline and often require Python/PyTorch, model access approval, or server-side support. No fake speaker labels are generated.
- Whisper can normalize or omit fillers even with a prompt. Clean-verbatim postprocessing is intentionally conservative and currently has a basic English filler list; other languages are left unchanged.
- `return_timestamps` and chunked ASR behavior can vary by Transformers.js/model version. SRT/VTT exports use returned model chunks. If the model returns only one chunk, exports may have coarse timing.
- Browser codec support differs. MP4/M4A decoding depends on the browser's media/audio decoder. WAV or MP3 is the safest fallback.
- WebGPU availability depends on browser, device, and drivers. WASM is the fallback and may be slow on low-end phones. The Small model may need substantial memory.
- Files longer than 15 minutes are rejected to avoid excessive memory use. Files under 3 minutes are allowed with a notice.
- Browsers can evict cached model files. A first model download is required and needs internet access.
- Transformers.js loads its runtime and model assets from CDN endpoints; hosting the page itself is static, but this is not an offline-first bundle.
- A browser's Web Audio decoder may briefly allocate memory for the decoded audio before the worker starts. Models themselves run in a worker to keep inference off the UI thread.

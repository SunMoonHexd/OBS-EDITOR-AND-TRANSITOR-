const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Estado OBS ────────────────────────────────────────────────────────────────
let obsSocket = null;
let obsConnected = false;
let obsState = { recording: false, replayActive: false, scenes: [], currentScene: '' };
let frontendClients = new Set();

// ─── Broadcast a todos los clientes frontend ───────────────────────────────────
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  frontendClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

// ─── WebSocket proxy entre frontend y OBS ──────────────────────────────────────
wss.on('connection', (ws) => {
  frontendClients.add(ws);

  // Enviar estado actual al nuevo cliente
  ws.send(JSON.stringify({ event: 'serverState', data: { obsConnected, obsState } }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'connectOBS') connectToOBS(msg.url, msg.password);
      if (msg.action === 'obsCommand') sendToOBS(msg.type, msg.data);
    } catch(e) { console.error('WS parse error:', e); }
  });

  ws.on('close', () => frontendClients.delete(ws));
});

// ─── Conexión real a OBS WebSocket v5 ─────────────────────────────────────────
function connectToOBS(url = 'ws://localhost:4455', password = '') {
  if (obsSocket) { try { obsSocket.close(); } catch(e) {} }

  console.log(`[OBS] Conectando a ${url}...`);
  obsSocket = new WebSocket(url);

  obsSocket.on('open', () => {
    console.log('[OBS] Conectado, iniciando handshake...');
  });

  obsSocket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    switch(msg.op) {
      case 0: // Hello
        const identify = { op: 1, d: { rpcVersion: 1 } };
        if (password && msg.d.authentication) {
          const crypto = require('crypto');
          const { challenge, salt } = msg.d.authentication;
          const base64secret = crypto.createHash('sha256').update(password + salt).digest('base64');
          const authStr = crypto.createHash('sha256').update(base64secret + challenge).digest('base64');
          identify.d.authentication = authStr;
        }
        obsSocket.send(JSON.stringify(identify));
        break;

      case 2: // Identified
        obsConnected = true;
        console.log('[OBS] Autenticado correctamente');
        broadcast('obsConnected', {});
        sendToOBS('GetSceneList');
        sendToOBS('GetRecordStatus');
        sendToOBS('GetReplayBufferStatus');
        break;

      case 5: // Event
        handleOBSEvent(msg.d);
        break;

      case 7: // RequestResponse
        handleOBSResponse(msg.d);
        break;
    }
  });

  obsSocket.on('close', () => {
    obsConnected = false;
    console.log('[OBS] Desconectado');
    broadcast('obsDisconnected', {});
    setTimeout(() => connectToOBS(url, password), 5000);
  });

  obsSocket.on('error', (e) => {
    console.warn('[OBS] Error de conexión:', e.message);
  });
}

let reqCallbacks = {};
function sendToOBS(requestType, requestData = {}) {
  if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN) return null;
  const requestId = Math.random().toString(36).substr(2, 9);
  obsSocket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  return requestId;
}

function handleOBSEvent(d) {
  const { eventType, eventData } = d;
  switch(eventType) {
    case 'RecordStateChanged':
      obsState.recording = eventData.outputActive;
      broadcast('recordState', { active: eventData.outputActive, path: eventData.outputPath });
      break;
    case 'ReplayBufferStateChanged':
      obsState.replayActive = eventData.outputActive;
      broadcast('replayState', { active: eventData.outputActive });
      break;
    case 'ReplayBufferSaved':
      broadcast('replaySaved', { path: eventData.savedReplayPath });
      break;
    case 'CurrentProgramSceneChanged':
      obsState.currentScene = eventData.sceneName;
      broadcast('sceneChanged', { scene: eventData.sceneName });
      break;
    case 'SceneListChanged':
      obsState.scenes = eventData.scenes.map(s => s.sceneName);
      broadcast('scenesUpdated', { scenes: obsState.scenes });
      break;
  }
}

function handleOBSResponse(d) {
  const { requestType, responseData = {}, requestStatus } = d;
  if (requestStatus && !requestStatus.result) {
    console.log(`[OBS] Request ${requestType} falló: ${requestStatus.comment || ''}`);
    return;
  }
  switch(requestType) {
    case 'GetSceneList':
      obsState.scenes = (responseData.scenes || []).map(s => s.sceneName).reverse();
      obsState.currentScene = responseData.currentProgramSceneName;
      broadcast('scenesUpdated', { scenes: obsState.scenes, current: obsState.currentScene });
      break;
    case 'GetRecordStatus':
      obsState.recording = responseData.outputActive ?? false;
      broadcast('recordState', { active: obsState.recording });
      break;
    case 'GetReplayBufferStatus':
      obsState.replayActive = responseData.outputActive ?? false;
      broadcast('replayState', { active: obsState.replayActive });
      break;
  }
}

// ─── API REST ──────────────────────────────────────────────────────────────────

app.get('/api/files', (req, res) => {
  const dir = req.query.dir || require('os').homedir();
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
      .filter(e => {
        if (e.isDirectory()) return true;
        return /\.(mp4|mkv|mov|avi|flv|ts|webm)$/i.test(e.name);
      })
      .map(e => ({
        name: e.name,
        isDir: e.isDirectory(),
        path: path.join(dir, e.name),
        size: e.isDirectory() ? null : fs.statSync(path.join(dir, e.name)).size
      }));
    res.json({ dir, files });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/probe', (req, res) => {
  const file = req.query.file;
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Archivo no encontrado' });
  exec(`ffprobe -v quiet -print_format json -show_streams -show_format "${file}"`, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'ffprobe falló. ¿Tienes FFmpeg instalado?' });
    try { res.json(JSON.parse(stdout)); }
    catch(e) { res.status(500).json({ error: 'No se pudo parsear la respuesta de ffprobe' }); }
  });
});

app.get('/api/thumbnail', (req, res) => {
  const { file, time = '0' } = req.query;
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  exec(`ffmpeg -ss ${time} -i "${file}" -vframes 1 -vf "scale=160:90" -f image2pipe -vcodec png -`, { encoding: 'buffer' }, (err, stdout) => {
    if (err || !stdout.length) return res.status(500).end();
    res.setHeader('Content-Type', 'image/png');
    res.send(stdout);
  });
});

app.get('/api/video', (req, res) => {
  const file = req.query.file;
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  const stat = fs.statSync(file);
  const range = req.headers.range;
  const ext = path.extname(file).toLowerCase();
  const mime = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.webm': 'video/webm' }[ext] || 'video/mp4';
  if (range) {
    const [start, end] = range.replace(/bytes=/, '').split('-').map((v, i) => v ? parseInt(v) : (i === 1 ? stat.size - 1 : 0));
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime });
    fs.createReadStream(file).pipe(res);
  }
});

app.post('/api/export', (req, res) => {
  const { file, start, end, outputDir } = req.body;
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Archivo no encontrado' });

  const duration = end - start;
  if (duration <= 0) {
    return res.status(400).json({ error: 'Rango inválido: pon Mark In y Mark Out en posiciones diferentes.' });
  }

  const outName = `clip_${path.basename(file, path.extname(file))}_${Date.now()}.mp4`;
  const outPath = path.join(outputDir || path.dirname(file), outName);

  console.log(`[FFmpeg] Exportando ${duration.toFixed(1)}s desde ${start.toFixed(1)}s`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const proc = spawn('ffmpeg', [
    '-ss', start.toFixed(3), '-i', file,
    '-t', duration.toFixed(3), '-c', 'copy',
    '-avoid_negative_ts', 'make_zero', outPath
  ]);

  proc.on('error', (err) => {
    if (err.code === 'ENOENT') {
      res.write(`data: ${JSON.stringify({ error: 'FFmpeg no instalado. Ejecuta en una terminal nueva: winget install Gyan.FFmpeg' })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
    res.end();
  });

  proc.stderr.on('data', (d) => {
    const line = d.toString();
    const timeMatch = line.match(/time=(\d+:\d+:\d+\.\d+)/);
    if (timeMatch) res.write(`data: ${JSON.stringify({ progress: timeMatch[1] })}\n\n`);
  });

  proc.on('close', (code) => {
    if (code === 0) res.write(`data: ${JSON.stringify({ done: true, output: outPath, name: outName })}\n\n`);
    else res.write(`data: ${JSON.stringify({ error: 'FFmpeg falló con código ' + code })}\n\n`);
    res.end();
  });
});

// ─── Export Timeline (concatenar múltiples clips) ──────────────────────────────
app.post('/api/export-timeline', async (req, res) => {
  const { clips, outputDir } = req.body;

  if (!clips || !clips.length)
    return res.status(400).json({ error: 'No hay clips en el timeline.' });

  for (const clip of clips) {
    if (!clip.file || !fs.existsSync(clip.file))
      return res.status(404).json({ error: `Archivo no encontrado: ${clip.file || '(sin archivo)'}` });
  }

  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);
  if (totalDuration <= 0)
    return res.status(400).json({ error: 'Duración total inválida.' });

  const outDir = outputDir || path.dirname(clips[0].file);
  const outName = `timeline_export_${Date.now()}.mp4`;
  const outPath = path.join(outDir, outName);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    // Construir inputs: cada clip con su propio -ss y -t
    const inputs = [];
    clips.forEach((c) => {
      inputs.push('-ss', c.start.toFixed(3), '-t', c.duration.toFixed(3), '-i', c.file);
    });

    const n = clips.length;

    // filter_complex: video concat
    const vPads = clips.map((_, i) => `[${i}:v]`).join('');
    const aPads = clips.map((_, i) => `[${i}:a]`).join('');
    const filterComplex = `${vPads}concat=n=${n}:v=1:a=0[outv];${aPads}concat=n=${n}:v=0:a=1[outa]`;

    const args = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k',
      '-y', outPath
    ];

    console.log(`[FFmpeg Timeline] ${n} clips | ${totalDuration.toFixed(1)}s total`);

    const proc = spawn('ffmpeg', args);

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') send({ error: 'FFmpeg no encontrado. Instálalo primero.' });
      else send({ error: err.message });
      res.end();
    });

    let lastErr = '';
    proc.stderr.on('data', (d) => {
      const line = d.toString();
      lastErr += line;
      const m = line.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (m) send({ progress: m[1], total: totalDuration });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        send({ done: true, output: outPath, name: outName, clips: n });
        res.end();
        return;
      }
      // Retry sin audio si falló por streams de audio faltantes
      const audioErr = lastErr.includes('no such stream') || lastErr.includes('audio') || lastErr.includes('Stream map');
      if (audioErr) {
        send({ status: 'Reintentando sin audio...' });
        const filterV = `${vPads}concat=n=${n}:v=1:a=0[outv]`;
        const args2 = [
          ...inputs,
          '-filter_complex', filterV,
          '-map', '[outv]',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
          '-an', '-y', outPath
        ];
        const proc2 = spawn('ffmpeg', args2);
        proc2.stderr.on('data', (d2) => {
          const m2 = d2.toString().match(/time=(\d+:\d+:\d+\.\d+)/);
          if (m2) send({ progress: m2[1], total: totalDuration });
        });
        proc2.on('close', (code2) => {
          if (code2 === 0) send({ done: true, output: outPath, name: outName, clips: n });
          else send({ error: 'FFmpeg falló. Verifica que los archivos sean compatibles.' });
          res.end();
        });
      } else {
        send({ error: 'FFmpeg falló con código ' + code });
        res.end();
      }
    });

  } catch(e) {
    send({ error: e.message });
    res.end();
  }
});

// ─── Arrancar servidor ─────────────────────────────────────────────────────────
const PORT = 3333;
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  Minitimeline OBS Panel v2.0         ║`);
  console.log(`║  http://localhost:${PORT}              ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  connectToOBS('ws://localhost:4455', '');
});
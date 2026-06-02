import { Timeline, formatTC } from './components/timeline.js';
import { ServerService } from './services/server.js';

const $ = id => document.getElementById(id);

class App {
  constructor() {
    this.tl = new Timeline('tl-canvas', 'tl-viewport');
    this.server = new ServerService();
    this.isPlaying = false;
    this.rafId = null;
    this.currentFile = null;
    this.currentDir = null;
    this.obsConnected = false;
    this.recording = false;
    this.replayOn = false;

    this._bindAll();
    this._loadInitialDir();
  }

  _bindAll() {
    // ── Playback ─────────────────────────────────────────
    $('btn-play-pause').onclick = () => this._togglePlay();
    $('btn-prev-marker').onclick = () => this.tl.prevMarker();
    $('btn-next-marker').onclick = () => this.tl.nextMarker();

    // ── Timeline tools ───────────────────────────────────
    $('btn-mark-in').onclick = () => { this.tl.markIn = this.tl.currentTime; this.tl.render(); this._updateRangeText(); };
    $('btn-mark-out').onclick = () => { this.tl.markOut = this.tl.currentTime; this.tl.render(); this._updateRangeText(); };
    $('btn-add-marker').onclick = () => this.tl.addMarker(this.tl.currentTime);
    $('btn-export-clip').onclick = () => this._exportClip();
    $('btn-export-timeline').onclick = () => this._exportTimeline();

    // Herramientas
    $('tool-cursor').onclick = () => { this.tl.setTool('cursor'); $('tool-cursor').classList.add('active'); $('tool-blade').classList.remove('active'); };
    $('tool-blade').onclick = () => { this.tl.setTool('blade'); $('tool-blade').classList.add('active'); $('tool-cursor').classList.remove('active'); };

    // Zoom
    $('zoom-slider').oninput = (e) => {
      const v = Number(e.target.value);
      this.tl.setZoom(v);
      $('zoom-label').textContent = `${v}px/s`;
    };

    // ── File browser navigation ───────────────────────────
    $('btn-browse-up').onclick = () => {
      if (!this.currentDir) return;
      // Calcular el directorio padre (funciona en Windows y Unix)
      const sep = this.currentDir.includes('\\') ? '\\' : '/';
      const parts = this.currentDir.replace(/[/\\]+$/, '').split(sep);
      if (parts.length <= 1) return; // ya estamos en la raíz
      parts.pop();
      const parent = parts.join(sep) || sep;
      this._browseDir(parent);
    };

    // ── OBS controls ─────────────────────────────────────
    $('btn-obs-connect').onclick = () => {
      const url = $('obs-url').value.trim() || 'ws://localhost:4455';
      const pass = $('obs-pass').value.trim();
      this.server.connectOBS(url, pass);
    };

    $('btn-record').onclick = () => {
      this.server.obsCommand(this.recording ? 'StopRecord' : 'StartRecord');
    };
    $('btn-replay-toggle').onclick = () => {
      this.server.obsCommand(this.replayOn ? 'StopReplayBuffer' : 'StartReplayBuffer');
    };
    $('btn-save-replay').onclick = () => {
      if (!this.replayOn) { alert('Activa el Replay Buffer primero.'); return; }
      this.server.obsCommand('SaveReplayBuffer');
    };

    // ── Canvas events ────────────────────────────────────
    const canvas = $('tl-canvas');
    canvas.addEventListener('timeUpdate', e => this._onTimeUpdate(e.detail));
    canvas.addEventListener('rangeChanged', e => this._updateRangeText(e.detail));
    canvas.addEventListener('clipsChanged', e => this._renderClipsList(e.detail));

    // Preview video sync
    const vid = $('preview-video');
    vid.ontimeupdate = () => {
      if (!this.isPlaying) return;
      this.tl.setCurrentTime(vid.currentTime);
    };
    vid.onended = () => this._stopPlay();

    // ── Server / OBS events ──────────────────────────────
    this.server.addEventListener('obsConnected', () => {
      this.obsConnected = true;
      $('obs-dot').className = 'dot connected';
      $('obs-label').textContent = 'OBS CONNECTED';
      $('obs-connect-row').classList.add('hidden');
    });

    this.server.addEventListener('obsDisconnected', () => {
      this.obsConnected = false;
      $('obs-dot').className = 'dot disconnected';
      $('obs-label').textContent = 'OBS DISCONNECTED';
      $('obs-connect-row').classList.remove('hidden');
    });

    this.server.addEventListener('serverState', e => {
      const { obsConnected, obsState } = e.detail;
      if (obsConnected) {
        $('obs-dot').className = 'dot connected';
        $('obs-label').textContent = 'OBS CONNECTED';
        $('obs-connect-row').classList.add('hidden');
      }
      if (obsState?.scenes?.length) this._renderScenes(obsState.scenes, obsState.currentScene);
      if (obsState?.currentScene) $('scene-badge').textContent = obsState.currentScene;
    });

    this.server.addEventListener('scenesUpdated', e => {
      this._renderScenes(e.detail.scenes, e.detail.current);
    });

    this.server.addEventListener('sceneChanged', e => {
      $('scene-badge').textContent = e.detail.scene;
      document.querySelectorAll('.scene-item').forEach(el => {
        el.classList.toggle('active', el.dataset.scene === e.detail.scene);
      });
    });

    this.server.addEventListener('recordState', e => {
      this.recording = e.detail.active;
      $('btn-record').classList.toggle('active', this.recording);
      $('obs-dot').className = `dot ${this.recording ? 'recording' : 'connected'}`;
      $('btn-record').textContent = this.recording ? '⏹ STOP REC' : '⏺ REC';
      if (e.detail.path) this._notifyNewFile(e.detail.path);
    });

    this.server.addEventListener('replayState', e => {
      this.replayOn = e.detail.active;
      $('btn-replay-toggle').classList.toggle('replay-on', this.replayOn);
      $('btn-replay-toggle').textContent = this.replayOn ? '🔄 Replay ON' : '🔄 Replay';
    });

    this.server.addEventListener('replaySaved', e => {
      if (e.detail.path) this._notifyNewFile(e.detail.path);
    });

    // ── Keyboard shortcuts ───────────────────────────────
    window.addEventListener('keydown', (e) => {
      if (document.activeElement.tagName === 'INPUT') return;
      switch(e.key.toLowerCase()) {
        case ' ': e.preventDefault(); this._togglePlay(); break;
        case 'i': this.tl.markIn = this.tl.currentTime; this.tl.render(); this._updateRangeText(); break;
        case 'o': this.tl.markOut = this.tl.currentTime; this.tl.render(); this._updateRangeText(); break;
        case 'm': this.tl.addMarker(this.tl.currentTime); break;
        case 'v': $('tool-cursor').click(); break;
        case 'c': $('tool-blade').click(); break;
      }
    });
  }

  // ── File browser ──────────────────────────────────────
  async _loadInitialDir() {
    // Intentar con la carpeta de videos del usuario, o el home
    const dirs = ['Videos', 'Vídeos', 'Movies'];
    try {
      const r = await this.server.getFiles('');
      const homeDir = r.dir;
      // buscar subcarpeta de videos
      for (const d of dirs) {
        const candidate = homeDir + (navigator.platform.includes('Win') ? '\\' : '/') + d;
        try {
          await this._browseDir(candidate);
          return;
        } catch(e) {}
      }
      await this._browseDir(homeDir);
    } catch(e) {
      await this._browseDir('/');
    }
  }

  async _browseDir(dir) {
    const { dir: resolvedDir, files } = await this.server.getFiles(dir);
    this.currentDir = resolvedDir;
    $('current-dir').textContent = resolvedDir;

    const list = $('files-list');
    list.innerHTML = '';

    files.forEach(f => {
      const el = document.createElement('div');
      el.className = f.isDir ? 'dir-item' : 'file-item';
      const icon = document.createElement('span');
      icon.className = 'file-icon ' + (f.isDir ? 'dir-icon' : '');
      icon.textContent = f.isDir ? '📁' : '🎬';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = f.name;

      el.appendChild(icon);
      el.appendChild(name);

      if (!f.isDir && f.size) {
        const sz = document.createElement('span');
        sz.className = 'file-size';
        sz.textContent = this._fmtSize(f.size);
        el.appendChild(sz);
      }

      if (f.isDir) {
        el.onclick = () => this._browseDir(f.path);
      } else {
        el.draggable = true;
        el.onclick = () => this._selectFile(f.path, f.name);
        el.ondragstart = async (ev) => {
          // intentar obtener duración del archivo
          let dur = 60;
          try {
            const info = await this.server.probeFile(f.path);
            dur = parseFloat(info.format?.duration || 60);
          } catch(e) {}
          ev.dataTransfer.setData('text/plain', JSON.stringify({
            name: f.name, file: f.path, duration: dur
          }));
        };
      }

      list.appendChild(el);
    });
  }

  async _selectFile(path, name) {
    this.currentFile = path;

    // Marcar seleccionado
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
    event?.target?.closest('.file-item')?.classList.add('selected');

    // Cargar en el preview video
    const vid = $('preview-video');
    vid.src = this.server.getVideoUrl(path);
    vid.classList.add('visible');
    $('preview-placeholder').classList.add('hidden');

    // Obtener duración real
    try {
      const info = await this.server.probeFile(path);
      const dur = parseFloat(info.format?.duration || 60);
      this.tl.duration = Math.max(this.tl.duration, dur + 10);
      this.tl.canvas.width = Math.max(this.tl.viewport.clientWidth, this.tl.duration * this.tl.zoom);

      // Auto-agregar al timeline si no hay clips
      if (!this.tl.clips.find(c => c.file === path)) {
        this.tl.addClip({ name, file: path, start: 0, duration: dur, track: 0 });
      }
    } catch(e) {}
  }

  _notifyNewFile(path) {
    const name = path.split(/[\\/]/).pop();
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed;bottom:220px;right:12px;background:#1a1a1f;
      border:1px solid #22d3a0;border-radius:4px;padding:8px 12px;
      font-size:10px;color:#22d3a0;z-index:50;animation:fadeIn .3s;
    `;
    toast.textContent = `💾 Guardado: ${name}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);

    // Refrescar lista si el archivo está en el directorio actual
    if (path.startsWith(this.currentDir)) {
      this._browseDir(this.currentDir);
    }
  }

  // ── Scenes ────────────────────────────────────────────
  _renderScenes(scenes, current) {
    const list = $('scenes-list');
    list.innerHTML = '';
    if (!scenes.length) { list.innerHTML = '<span class="muted">Sin escenas</span>'; return; }
    scenes.forEach(s => {
      const el = document.createElement('div');
      el.className = 'scene-item' + (s === current ? ' active' : '');
      el.dataset.scene = s;
      el.textContent = s;
      el.onclick = () => this.server.obsCommand('SetCurrentProgramScene', { sceneName: s });
      list.appendChild(el);
    });
    if (current) $('scene-badge').textContent = current;
  }

  // ── Clips list sidebar ────────────────────────────────
  _renderClipsList(clips) {
    const list = $('clips-list');
    list.innerHTML = '';
    if (!clips.length) { list.innerHTML = '<span class="muted">Sin clips</span>'; return; }
    clips.forEach(c => {
      const el = document.createElement('div');
      el.className = 'clip-item';
      el.innerHTML = `
        <div class="clip-dot" style="background:${c.color}"></div>
        <span class="clip-name" title="${c.name}">${c.name}</span>
        <span class="clip-dur">${formatTC(c.duration)}</span>
        <button style="background:none;border:none;color:#6b6b7a;cursor:pointer;font-size:12px" title="Eliminar">✕</button>
      `;
      el.onclick = () => {
        if (c.file) this._selectFile(c.file, c.name);
        this.tl.setCurrentTime(c.start);
      };
      el.querySelector('button').onclick = (e) => {
        e.stopPropagation();
        this.tl.removeClip(c.id);
      };
      list.appendChild(el);
    });
  }

  // ── Playback ──────────────────────────────────────────
  _togglePlay() {
    this.isPlaying ? this._stopPlay() : this._startPlay();
  }

  _startPlay() {
    this.isPlaying = true;
    $('btn-play-pause').textContent = '⏸';

    const vid = $('preview-video');
    if (vid.src && vid.readyState >= 2) {
      vid.currentTime = this.tl.currentTime;
      vid.play();
      return;
    }

    // Playback sin video (solo timeline)
    let last = performance.now();
    const loop = (now) => {
      if (!this.isPlaying) return;
      const dt = (now - last) / 1000;
      last = now;
      this.tl.setCurrentTime(this.tl.currentTime + dt);
      if (this.tl.currentTime >= this.tl.duration) { this._stopPlay(); return; }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  _stopPlay() {
    this.isPlaying = false;
    $('btn-play-pause').textContent = '▶';
    $('preview-video').pause();
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  _onTimeUpdate(t) {
    $('tc-display').textContent = formatTC(t);
    // Sincronizar video con timeline al hacer scrub
    const vid = $('preview-video');
    if (!this.isPlaying && vid.src && Math.abs(vid.currentTime - t) > 0.2) {
      vid.currentTime = t;
    }
  }

  _updateRangeText(range) {
    const i = this.tl.markIn;
    const o = this.tl.markOut;
    if (i === null || o === null) {
      $('range-text').textContent = 'Sin selección';
      $('selection-info').textContent = '—';
      return;
    }
    const dur = Math.abs(o - i);
    $('range-text').textContent = `${formatTC(Math.min(i,o))} → ${formatTC(Math.max(i,o))} (${formatTC(dur)})`;
    $('selection-info').textContent = `Sel: ${formatTC(dur)}`;
  }

  // ── Export real ───────────────────────────────────────
  async _exportClip() {
    const i = this.tl.markIn;
    const o = this.tl.markOut;
    if (i === null || o === null) { alert('Define un rango con Mark In [I] y Mark Out [O] primero.'); return; }
    if (!this.currentFile) { alert('Selecciona un archivo de video primero.'); return; }

    const start = Math.min(i, o);
    const end = Math.max(i, o);

    $('export-modal').classList.remove('hidden');
    $('export-progress-fill').style.width = '5%';
    $('export-status').textContent = 'Iniciando FFmpeg…';

    try {
      const resp = await this.server.exportClip(this.currentFile, start, end);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const duration = end - start;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = JSON.parse(line.slice(5).trim());
          if (data.progress) {
            const parts = data.progress.split(':').map(Number);
            const secs = parts[0]*3600 + parts[1]*60 + parts[2];
            const pct = Math.min(95, (secs / duration) * 100);
            $('export-progress-fill').style.width = pct + '%';
            $('export-status').textContent = `Procesando… ${data.progress}`;
          }
          if (data.done) {
            $('export-progress-fill').style.width = '100%';
            $('export-status').textContent = `✅ Exportado: ${data.name}`;
            setTimeout(() => {
              $('export-modal').classList.add('hidden');
              this._notifyNewFile(data.output);
            }, 2000);
          }
          if (data.error) {
            $('export-status').textContent = '❌ ' + data.error;
            setTimeout(() => $('export-modal').classList.add('hidden'), 3000);
          }
        }
      }
    } catch(e) {
      $('export-status').textContent = '❌ Error: ' + e.message;
      setTimeout(() => $('export-modal').classList.add('hidden'), 3000);
    }
  }

  // ── Export Timeline (todos los clips en orden) ────────────────────────────
  async _exportTimeline() {
    const clips = [...this.tl.clips].sort((a, b) => a.start - b.start);

    if (!clips.length) {
      alert('No hay clips en el timeline. Arrastra archivos desde el panel de assets.');
      return;
    }

    const sinArchivo = clips.filter(c => !c.file);
    if (sinArchivo.length) {
      alert(`${sinArchivo.length} clip(s) no tienen archivo de video asociado. Asegúrate de cargar los archivos desde el explorador.`);
      return;
    }

    // Preparar payload: solo lo que necesita el servidor
    const payload = clips.map(c => ({
      file: c.file,
      start: c.start,
      duration: c.duration,
      name: c.name
    }));

    const totalSec = payload.reduce((s, c) => s + c.duration, 0);

    $('export-modal').classList.remove('hidden');
    $('export-progress-fill').style.width = '3%';
    $('export-status').textContent = `Preparando ${clips.length} clip(s) (${formatTC(totalSec)} total)…`;

    try {
      const resp = await this.server.exportTimeline(payload);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = JSON.parse(line.slice(5).trim());

          if (data.status) {
            $('export-status').textContent = data.status;
          }

          if (data.progress) {
            // Convertir HH:MM:SS.mm a segundos para la barra
            const [hh, mm, ssmm] = data.progress.split(':');
            const secs = +hh * 3600 + +mm * 60 + parseFloat(ssmm);
            const pct = Math.min(95, (secs / (data.total || totalSec)) * 100);
            $('export-progress-fill').style.width = pct + '%';
            $('export-status').textContent = `Procesando… ${data.progress} / ${formatTC(data.total || totalSec)}`;
          }

          if (data.done) {
            $('export-progress-fill').style.width = '100%';
            $('export-status').textContent = `✅ Timeline exportado: ${data.name} (${data.clips} clips)`;
            setTimeout(() => {
              $('export-modal').classList.add('hidden');
              this._notifyNewFile(data.output);
            }, 2500);
          }

          if (data.error) {
            $('export-status').textContent = '❌ ' + data.error;
            setTimeout(() => $('export-modal').classList.add('hidden'), 4000);
          }
        }
      }
    } catch(e) {
      $('export-status').textContent = '❌ Error: ' + e.message;
      setTimeout(() => $('export-modal').classList.add('hidden'), 3000);
    }
  }

  _fmtSize(bytes) {
    if (bytes > 1e9) return (bytes/1e9).toFixed(1) + ' GB';
    if (bytes > 1e6) return (bytes/1e6).toFixed(0) + ' MB';
    return (bytes/1e3).toFixed(0) + ' KB';
  }
}

window.addEventListener('DOMContentLoaded', () => new App());

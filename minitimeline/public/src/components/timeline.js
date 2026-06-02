export function formatTC(s, fps = 60) {
  if (isNaN(s) || s < 0) return '00:00:00:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = Math.floor(s % 60);
  const f = Math.floor((s % 1) * fps);
  return [h,m,sc,f].map(v => v.toString().padStart(2,'0')).join(':');
}

const RULER_H = 26;
const TRACK_H = 56;
const TRACK_PAD = 5;
const COLORS = ['#1e40af','#065f46','#92400e','#6b21a8'];

export class Timeline {
  constructor(canvasId, viewportId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.viewport = document.getElementById(viewportId);

    this.zoom = 80;
    this.duration = 300;
    this.currentTime = 0;
    this.markIn = null;
    this.markOut = null;
    this.markers = [];
    this.clips = [];

    this.isDraggingScrubber = false;
    this.draggedClip = null;
    this.dragOffset = 0;
    this.activeTool = 'cursor'; // cursor | blade

    this._setupResize();
    this._setupEvents();
  }

  _setupResize() {
    const sync = () => {
      const h = this.viewport.clientHeight;
      const w = Math.max(this.viewport.clientWidth, this.duration * this.zoom);
      if (h > 0) this.canvas.height = h;
      this.canvas.width = w;
      this.render();
    };
    new ResizeObserver(sync).observe(this.viewport);
    window.addEventListener('resize', sync);
    // Forzar sync inicial después de que el DOM esté listo
    requestAnimationFrame(sync);
  }

  setZoom(v) {
    this.zoom = v;
    this.canvas.width = Math.max(this.viewport.clientWidth, this.duration * this.zoom);
    this.render();
  }

  setTool(t) { this.activeTool = t; }

  setCurrentTime(t) {
    this.currentTime = Math.max(0, Math.min(t, this.duration));
    this.render();
    this._autoScroll();
    this._emit('timeUpdate', this.currentTime);
  }

  addMarker(t) {
    this.markers.push({ time: t, id: Date.now() });
    this.markers.sort((a,b) => a.time - b.time);
    this.render();
  }

  addClip(data) {
    const idx = this.clips.filter(c => c.track === (data.track||0)).length;
    this.clips.push({
      id: Date.now() + Math.random(),
      name: data.name,
      start: data.start,
      duration: data.duration,
      track: data.track || 0,
      file: data.file || null,
      color: COLORS[(data.track||0) % COLORS.length]
    });
    this.render();
    this._emit('clipsChanged', this.clips);
  }

  removeClip(id) {
    this.clips = this.clips.filter(c => c.id !== id);
    this.render();
    this._emit('clipsChanged', this.clips);
  }

  _getTrackY(trackIdx) {
    return RULER_H + TRACK_PAD + trackIdx * (TRACK_H + TRACK_PAD);
  }

  _clipAt(x, y) {
    const t = x / this.zoom;
    return this.clips.find(c => {
      const ty = this._getTrackY(c.track);
      return t >= c.start && t <= c.start + c.duration && y >= ty && y <= ty + TRACK_H;
    });
  }

  _setupEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const t = x / this.zoom;

      // Click en el ruler O cerca del playhead → arrastrar scrubber
      const scrubberX = this.currentTime * this.zoom;
      const nearScrubber = Math.abs(x - scrubberX) <= 8;
      if (y <= RULER_H || nearScrubber) {
        this.isDraggingScrubber = true;
        this.setCurrentTime(t);
        return;
      }

      if (this.activeTool === 'blade') {
        const hit = this._clipAt(x, y);
        if (hit) this._splitClip(hit, t);
        return;
      }

      const hit = this._clipAt(x, y);
      if (hit) {
        this.draggedClip = hit;
        this.dragOffset = t - hit.start;
      } else if (e.shiftKey) {
        this.markIn = t;
        this.markOut = t;
        this.isDraggingRange = true;
      } else {
        // Click en área vacía del track → también mueve el scrubber
        this.isDraggingScrubber = true;
        this.setCurrentTime(t);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDraggingScrubber && !this.draggedClip && !this.isDraggingRange) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.max(0, e.clientX - rect.left);
      const t = x / this.zoom;

      if (this.isDraggingScrubber) {
        this.setCurrentTime(t);
      } else if (this.draggedClip) {
        let ns = t - this.dragOffset;
        if (Math.abs(ns - Math.round(ns)) < 0.12) ns = Math.round(ns);
        this.draggedClip.start = Math.max(0, ns);
        this.render();
      } else if (this.isDraggingRange) {
        this.markOut = t;
        this.render();
        this._emit('rangeChanged', { in: this.markIn, out: this.markOut });
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDraggingScrubber = false;
      this.draggedClip = null;
      this.isDraggingRange = false;
    });

    // Drop de assets al timeline
    this.viewport.addEventListener('dragover', e => e.preventDefault());
    this.viewport.addEventListener('drop', (e) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dropTime = x / this.zoom;
        let track = 0;
        for (let i = 0; i < 4; i++) {
          const ty = this._getTrackY(i);
          if (y >= ty && y <= ty + TRACK_H) { track = i; break; }
        }
        this.addClip({ ...data, start: dropTime, track });
      } catch(e) {}
    });
  }

  _splitClip(clip, splitTime) {
    if (splitTime <= clip.start || splitTime >= clip.start + clip.duration) return;
    const left = { ...clip, id: Date.now(), duration: splitTime - clip.start };
    const right = { ...clip, id: Date.now() + 1, start: splitTime, duration: clip.start + clip.duration - splitTime };
    this.clips = this.clips.filter(c => c.id !== clip.id);
    this.clips.push(left, right);
    this.render();
    this._emit('clipsChanged', this.clips);
  }

  _autoScroll() {
    const sx = this.currentTime * this.zoom;
    const l = this.viewport.scrollLeft;
    const r = l + this.viewport.clientWidth;
    if (sx > r - 60) this.viewport.scrollLeft = sx - this.viewport.clientWidth + 120;
    else if (sx < l + 60) this.viewport.scrollLeft = Math.max(0, sx - 120);
  }

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this._drawRuler();
    this._drawTracks();
    this._drawSelection();
    this._drawClips();
    this._drawMarkers();
    this._drawScrubber();
  }

  _drawRuler() {
    const { ctx, canvas, zoom, duration } = this;
    ctx.fillStyle = '#141417';
    ctx.fillRect(0, 0, canvas.width, RULER_H);
    ctx.strokeStyle = '#2a2a32';
    ctx.lineWidth = 1;

    const step = zoom < 20 ? 10 : zoom < 50 ? 5 : zoom < 120 ? 2 : 1;
    ctx.fillStyle = '#6b6b7a';
    ctx.font = '9px JetBrains Mono, monospace';

    for (let i = 0; i <= duration; i += step) {
      const x = i * zoom;
      const isMajor = i % (step * 5) === 0;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, RULER_H - (isMajor ? 14 : 7));
      ctx.stroke();
      if (isMajor || zoom > 60) {
        ctx.fillText(formatTC(i), x + 3, 14);
      }
    }
  }

  _drawTracks() {
    const { ctx, canvas } = this;
    const trackCount = Math.max(2, ...this.clips.map(c => c.track + 1), 2);
    const labels = ['VIDEO V1', 'AUDIO A1', 'VIDEO V2', 'AUDIO A2'];
    for (let i = 0; i < trackCount; i++) {
      const y = this._getTrackY(i);
      ctx.fillStyle = '#18181c';
      ctx.fillRect(0, y, canvas.width, TRACK_H);
      ctx.strokeStyle = '#222228';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, y, canvas.width, TRACK_H);
      ctx.fillStyle = '#3a3a48';
      ctx.font = 'bold 8px Syne, sans-serif';
      ctx.fillText(labels[i] || `TRACK ${i+1}`, 5, y + 13);
    }
  }

  _drawSelection() {
    if (this.markIn === null || this.markOut === null) return;
    const { ctx, canvas, zoom } = this;
    const x1 = Math.min(this.markIn, this.markOut) * zoom;
    const x2 = Math.max(this.markIn, this.markOut) * zoom;
    ctx.fillStyle = 'rgba(124,92,252,0.12)';
    ctx.fillRect(x1, RULER_H, x2 - x1, canvas.height);
    ctx.strokeStyle = 'rgba(124,92,252,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, 0); ctx.lineTo(x1, canvas.height);
    ctx.moveTo(x2, 0); ctx.lineTo(x2, canvas.height);
    ctx.stroke();
  }

  _drawClips() {
    const { ctx, zoom } = this;
    this.clips.forEach(clip => {
      const x = clip.start * zoom;
      const w = Math.max(clip.duration * zoom, 4);
      const y = this._getTrackY(clip.track);
      const isAudio = clip.track % 2 === 1;

      // sombra
      ctx.shadowColor = clip.color;
      ctx.shadowBlur = this.draggedClip?.id === clip.id ? 8 : 0;

      ctx.fillStyle = clip.color;
      ctx.beginPath();
      ctx.roundRect(x, y + 2, w, TRACK_H - 4, 3);
      ctx.fill();

      ctx.shadowBlur = 0;

      // highlight top
      const grad = ctx.createLinearGradient(0, y, 0, y + TRACK_H);
      grad.addColorStop(0, 'rgba(255,255,255,0.12)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y + 2, w, TRACK_H - 4, 3);
      ctx.fill();

      // borde
      ctx.strokeStyle = this.draggedClip?.id === clip.id ? '#a78bfa' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y + 2, w, TRACK_H - 4, 3);
      ctx.stroke();

      // waveform para audio
      if (isAudio && w > 20) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let sx = 2; sx < w - 2; sx += 3) {
          const amp = Math.abs(Math.sin(sx * 0.15 + clip.id)) * 0.7 + 0.1;
          const bh = amp * (TRACK_H - 16);
          ctx.fillRect(x + sx, y + 2 + (TRACK_H - 4 - bh) / 2, 1.5, bh);
        }
      }

      // label
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 4, y, w - 8, TRACK_H);
      ctx.clip();
      ctx.fillStyle = '#fff';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(clip.name, x + 6, y + TRACK_H - 10);
      ctx.restore();
    });
  }

  _drawMarkers() {
    const { ctx, zoom } = this;
    this.markers.forEach(m => {
      const x = m.time * zoom;
      ctx.fillStyle = '#f5a623';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x - 5, RULER_H - 9);
      ctx.lineTo(x - 5, 3);
      ctx.lineTo(x + 5, 3);
      ctx.lineTo(x + 5, RULER_H - 9);
      ctx.closePath();
      ctx.fill();
    });
  }

  _drawScrubber() {
    const { ctx, canvas } = this;
    const x = this.currentTime * this.zoom;
    ctx.strokeStyle = '#f0483e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
    ctx.stroke();
    ctx.fillStyle = '#f0483e';
    ctx.beginPath();
    ctx.arc(x, RULER_H, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  _emit(name, detail) {
    this.canvas.dispatchEvent(new CustomEvent(name, { detail }));
  }

  prevMarker() {
    const m = [...this.markers].reverse().find(m => m.time < this.currentTime - 0.05);
    if (m) this.setCurrentTime(m.time);
  }
  nextMarker() {
    const m = this.markers.find(m => m.time > this.currentTime + 0.05);
    if (m) this.setCurrentTime(m.time);
  }
}

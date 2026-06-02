// Comunicación con el servidor Node.js local
const WS_URL = `ws://${location.host}`;
const API = `http://${location.host}/api`;

export class ServerService extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.reconnectTimer = null;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.dispatchEvent(new CustomEvent('serverConnected'));
    };

    this.ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        this.dispatchEvent(new CustomEvent(event, { detail: data }));
      } catch(err) {}
    };

    this.ws.onclose = () => {
      this.dispatchEvent(new CustomEvent('serverDisconnected'));
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
  }

  send(action, payload = {}) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ action, ...payload }));
  }

  connectOBS(url, password) {
    this.send('connectOBS', { url, password });
  }

  obsCommand(type, data = {}) {
    this.send('obsCommand', { type, data });
  }

  async getFiles(dir) {
    const r = await fetch(`${API}/files?dir=${encodeURIComponent(dir)}`);
    return r.json();
  }

  async probeFile(file) {
    const r = await fetch(`${API}/probe?file=${encodeURIComponent(file)}`);
    return r.json();
  }

  getVideoUrl(file) {
    return `${API}/video?file=${encodeURIComponent(file)}`;
  }

  getThumbnailUrl(file, time = 0) {
    return `${API}/thumbnail?file=${encodeURIComponent(file)}&time=${time}`;
  }

  async exportClip(file, start, end) {
    const url = `${API}/export`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, start, end })
    });
  }

  async exportTimeline(clips) {
    return fetch(`${API}/export-timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clips })
    });
  }
}

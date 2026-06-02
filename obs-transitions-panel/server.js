/**
 * OBS Scene Transitions Panel — Server
 * Mismo patrón que Minitimeline_v2/server.js
 * Proxy WebSocket entre el panel frontend y OBS WebSocket v5
 */

const express = require('express');
const path    = require('path');
const http    = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const crypto  = require('crypto');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname)));

let obsSocket    = null;
let obsConnected = false;
let obsState     = { scenes: [], currentScene: '', currentTransition: '', transitionDuration: 500 };
let frontendClients = new Set();

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  frontendClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

wss.on('connection', (ws) => {
  frontendClients.add(ws);
  ws.send(JSON.stringify({ event: 'serverState', data: { obsConnected, obsState } }));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'connectOBS') connectToOBS(msg.url, msg.password);
      if (msg.action === 'obsCommand')  sendToOBS(msg.type, msg.data);
    } catch(e) { console.error('[WS] Parse error:', e.message); }
  });
  ws.on('close', () => frontendClients.delete(ws));
});

function connectToOBS(url = 'ws://localhost:4455', password = '') {
  if (obsSocket) { try { obsSocket.close(); } catch(e) {} }
  console.log(`[OBS] Conectando a ${url}...`);
  obsSocket = new WebSocket(url);

  obsSocket.on('open', () => console.log('[OBS] Conectado — iniciando handshake...'));

  obsSocket.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch(e) { return; }
    switch(msg.op) {
      case 0: {
        const identify = { op: 1, d: { rpcVersion: 1 } };
        if (password && msg.d.authentication) {
          const { challenge, salt } = msg.d.authentication;
          const base64secret = crypto.createHash('sha256').update(password + salt).digest('base64');
          identify.d.authentication = crypto.createHash('sha256').update(base64secret + challenge).digest('base64');
        }
        obsSocket.send(JSON.stringify(identify));
        break;
      }
      case 2:
        obsConnected = true;
        console.log('[OBS] Autenticado OK');
        broadcast('obsConnected', {});
        sendToOBS('GetSceneList');
        sendToOBS('GetCurrentSceneTransition');
        break;
      case 5: handleOBSEvent(msg.d); break;
      case 7: handleOBSResponse(msg.d); break;
    }
  });

  obsSocket.on('close', () => {
    obsConnected = false;
    console.log('[OBS] Desconectado');
    broadcast('obsDisconnected', {});
    setTimeout(() => connectToOBS(url, password), 5000);
  });

  obsSocket.on('error', (e) => console.warn('[OBS] Error:', e.message));
}

function sendToOBS(requestType, requestData = {}) {
  if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN) return;
  const requestId = Math.random().toString(36).substr(2, 9);
  obsSocket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
}

function handleOBSEvent(d) {
  const { eventType, eventData } = d;
  switch(eventType) {
    case 'CurrentProgramSceneChanged':
      obsState.currentScene = eventData.sceneName;
      broadcast('sceneChanged', { scene: eventData.sceneName });
      console.log(`[OBS] Escena -> ${eventData.sceneName}`);
      break;
    case 'SceneListChanged':
      obsState.scenes = eventData.scenes.map(s => s.sceneName);
      broadcast('scenesUpdated', { scenes: obsState.scenes, current: obsState.currentScene });
      break;
    case 'CurrentSceneTransitionChanged':
      obsState.currentTransition = eventData.transitionName;
      broadcast('transitionChanged', { name: eventData.transitionName });
      break;
    case 'CurrentSceneTransitionDurationChanged':
      obsState.transitionDuration = eventData.transitionDuration;
      broadcast('transitionDurationChanged', { duration: eventData.transitionDuration });
      break;
  }
}

function handleOBSResponse(d) {
  const { requestType, responseData = {}, requestStatus } = d;
  if (requestStatus && !requestStatus.result) {
    console.warn(`[OBS] ${requestType} fallo: ${requestStatus.comment || ''}`);
    return;
  }
  switch(requestType) {
    case 'GetSceneList':
      obsState.scenes = (responseData.scenes || []).map(s => s.sceneName).reverse();
      obsState.currentScene = responseData.currentProgramSceneName || '';
      broadcast('scenesUpdated', { scenes: obsState.scenes, current: obsState.currentScene });
      break;
    case 'GetCurrentSceneTransition':
      obsState.currentTransition = responseData.transitionName || '';
      broadcast('transitionChanged', { name: obsState.currentTransition });
      break;
  }
}

const PORT = process.env.PORT || 3334;
server.listen(PORT, () => {
  console.log('\n+-------------------------------------------+');
  console.log('|  OBS Scene Transitions Panel              |');
  console.log(`|  http://localhost:${PORT}                  |`);
  console.log('+-------------------------------------------+\n');
  connectToOBS('ws://localhost:4455', '');
});

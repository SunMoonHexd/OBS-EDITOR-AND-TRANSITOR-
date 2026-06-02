# OBS Scene Transitions Panel

Panel de transiciones rápidas entre escenas para OBS Studio.
Usa la misma arquitectura de conexión que Minitimeline_v2.

## Instalación

```bash
npm install
npm start
```

Abre http://localhost:3334 en tu navegador.

## Requisitos

- OBS Studio con el plugin **obs-websocket** activado (v5+)
- Node.js 18+

## Controles

| Acción | Tecla |
|--------|-------|
| Ir a escena 1–9 | Teclas `1`–`9` |
| Tipo: Fade | `F1` |
| Tipo: Slide | `F2` |
| Tipo: Zoom | `F3` |
| Tipo: Corte | `F4` |

## Tipos de transición

- **Fade** — Fundido cruzado entre escenas
- **Slide** — Deslizamiento (izquierda, derecha, arriba, abajo)
- **Zoom** — Zoom in/out
- **Corte rápido** — Cambio instantáneo sin transición

## Configuración OBS

En OBS → Herramientas → Configuración del servidor WebSocket:
- Habilitar: Sí
- Puerto: 4455

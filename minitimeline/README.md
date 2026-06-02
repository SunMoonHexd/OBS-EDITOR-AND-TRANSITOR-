# Minitimeline v2 — OBS Panel Real

Panel personalizado para OBS con edición y exportación real de clips.

## Requisitos

- **Node.js** (ya lo tienes ✅)
- **FFmpeg** — necesario para export y preview de info de video

### Instalar FFmpeg

**Windows:**
1. Descarga desde https://www.gyan.dev/ffmpeg/builds/ → `ffmpeg-release-essentials.zip`
2. Extrae en `C:\ffmpeg`
3. Agrega `C:\ffmpeg\bin` al PATH del sistema:
   - Busca "variables de entorno" en Windows
   - En "Variables del sistema" → Path → Editar → Nuevo → `C:\ffmpeg\bin`
4. Reinicia la terminal y verifica: `ffmpeg -version`

**Mac:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt install ffmpeg
```

---

## Instalar y ejecutar

```bash
cd Minitimeline_v2
npm install
npm start
```

Luego abre en el browser (o en OBS como Custom Browser Dock):
```
http://localhost:3333
```

---

## Configurar OBS

1. En OBS: **Herramientas → obs-websocket Settings**
2. Activa el servidor WebSocket
3. Puerto: `4455` (default)
4. Contraseña: la que quieras (o deja vacío)

### Agregar como Dock en OBS
1. **Vista → Docks → Custom Browser Docks**
2. Nombre: `Minitimeline`
3. URL: `http://localhost:3333`

---

## Uso

| Tecla | Acción |
|-------|--------|
| `Espacio` | Play / Pause |
| `I` | Mark In |
| `O` | Mark Out |
| `M` | Agregar marcador |
| `V` | Herramienta selección |
| `C` | Herramienta corte (navaja) |

- **Cargar video**: haz clic en un archivo `.mp4/.mkv/.mov` del panel de archivos
- **Agregar al timeline**: arrastra el archivo al timeline
- **Recortar**: mueve el scrubber, usa `I` y `O`, luego `Export Clip`
- **Exportar**: el export usa FFmpeg real sin re-encodear (copia directa, rápido)
- **OBS Scenes**: conecta OBS y verás tus escenas; haz clic para cambiar entre ellas

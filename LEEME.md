# Seguridad Minera IA – App para celular (MVP)

App web que corre **dentro del navegador del celular**: no necesita Colab, ni servidor de IA, ni internet una vez cargada.

```
app_seguridad/
├── index.html        ← la app (pantalla)
├── app.js            ← lógica: modelos, polígonos, reglas de seguridad
├── lib/              ← motor de IA (ONNX Runtime Web)
└── modelos/
    ├── coco.onnx     ← personas y vehículos (incluido)
    └── epp.onnx      ← TU modelo de EPP (lo agregas tú, ver paso 2)
```

## 1. Publicarla para abrirla en el celular (5 min)

La cámara en vivo solo funciona con **HTTPS**. La forma más rápida:

1. Entra a **https://app.netlify.com/drop** (crea una cuenta gratis con Google).
2. **Arrastra la carpeta `app_seguridad`** completa a la página.
3. Te da un link `https://xxxx.netlify.app`. Ábrelo en el celular.
4. En el celular: menú del navegador → **"Agregar a pantalla de inicio"**. Queda como una app.

Para actualizarla: en Netlify → tu sitio → **Deploys** → vuelve a arrastrar la carpeta.

> Alternativa: GitHub Pages (sube la carpeta a un repositorio y activa Pages).
> Para probar en la PC: abre la carpeta en VS Code y usa la extensión **Live Server**.

## 2. Agregar tu modelo de EPP

En Colab, cuando termine el entrenamiento, ejecuta:

```python
ruta = best.export(format="onnx", imgsz=640)
from google.colab import files
files.download(ruta)
```

Luego, **una de dos**:

- **A (recomendado):** renómbralo a `epp.onnx`, ponlo en `modelos/` y vuelve a subir la carpeta a Netlify.
- **B:** en la app → ⚙️ **Modelos y ajustes** → **Cargar mi modelo EPP**. Queda guardado en ese celular.

En ⚙️ revisa que las **clases** estén en el mismo orden que tu `data.yaml`
(por defecto: `Gloves,Helmet,No-Gloves,No-Helmet,No-Shoes,No-Vest,Shoes,Vest`).

## 3. Uso

| Botón | Qué hace |
|---|---|
| 📷 Foto | Abre la cámara, tomas una foto y la analiza |
| 🖼️ Galería | Analiza una foto guardada |
| 🎥 En vivo | Analiza la cámara continuamente (requiere HTTPS) |

Colores: 🟢 OK · 🟠 falta EPP · 🔴 zona de peligro · 🟡 lejos: verificar.
Los **contornos (polígonos)** del EPP y la **zona de peligro** se dibujan con la forma real de cada objeto.

En ⚙️ puedes ajustar la confianza, el margen de la zona de peligro y mostrar/ocultar los polígonos.
En 📋 **Registro de alertas** puedes descargar un **CSV** (para Power BI).

## Rendimiento esperado

- Foto: 1–4 s según el celular.
- En vivo: 0.5–2 imágenes/s en gama media (suficiente para pruebas; para tiempo real fluido se usará la app nativa o un equipo edge).

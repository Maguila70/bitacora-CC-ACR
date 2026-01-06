# Bitácora PWA (GitHub Pages)

## Opción A (recomendada): GitHub Pages desde la raíz
- En Settings → Pages:
  - Source: Deploy from a branch
  - Branch: main (o master)
  - Folder: /(root)
- Publica, y abre la URL de GitHub Pages.
- Para instalar en Android (Chrome): menú ⋮ → “Instalar app” o “Agregar a pantalla principal”.

## Opción B: GitHub Pages desde /docs
- En Settings → Pages:
  - Folder: /docs
- Publica, y abre la URL.

## Backend (Google Apps Script)
En `app.js` está configurada `API_BASE`. Debe apuntar al Web App (exec) que entregue al menos `?action=all`.

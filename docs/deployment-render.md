# Deploy en Render

Un solo Web Service Docker (FastAPI + Next.js) más una base PostgreSQL gestionada.

## 1. Base de datos

1. Render → **New +** → **PostgreSQL**.
2. Name `operacionesrm-db`, region `oregon`, plan Starter (o Free para pruebas).
3. Copiar la **Internal Database URL**.

## 2. Web Service

1. Render → **New +** → **Web Service** → conectar el repo de GitHub.
2. Runtime **Docker**, region `oregon` (la misma que la base), Auto-Deploy activado.
3. Health check path: `/api/v1/health`.
4. **Disk**: name `uploads`, mount path `/var/data`, 5 GB.

También se puede crear desde el blueprint `render.yaml` (New + → Blueprint).

## 3. Variables de entorno

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Internal Database URL del paso 1 (tal cual, se convierte sola) |
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `SUPERADMIN_EMAIL` | Email del administrador |
| `SUPERADMIN_PASSWORD` | Contraseña fuerte del administrador |
| `SUPERADMIN_NAME` | `Administrador Voicenter` |
| `ENV` | `production` |
| `UPLOAD_DIR` | `/var/data/uploads` — **tiene que estar dentro del mount path del disco**. Si el disco se montó en otra ruta (p. ej. `/persistenT`), poné `UPLOAD_DIR=/persistenT/uploads` o cambiá el mount path a `/var/data`. Si no coinciden, los archivos se pierden en cada despliegue; el log de arranque lo avisa (`Boot: UPLOAD_DIR=…`). |
| `BACKEND_URL` | `http://127.0.0.1:8000` |

## 4. Verificación

- `https://<servicio>.onrender.com/api/v1/health` responde `{"status":"ok","env":"production"}`.
- Entrar con el superadmin y crear el primer analista en **Usuarios**.

## Emergencias

- Re-correr migraciones: `POST /api/v1/admin/migrate?token=<SECRET_KEY>`.
- Rotar `SECRET_KEY` invalida todas las sesiones activas.

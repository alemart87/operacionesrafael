# Deploy en Render

Un solo Web Service Docker (FastAPI + Next.js) más una base PostgreSQL gestionada.

## 1. Base de datos

1. Render → **New +** → **PostgreSQL**.
2. Name `operacionesrm-db`, region `oregon`, plan pago (Basic o superior). El plan Free es solo para pruebas: no tiene
   respaldos ni recuperación. Los planes pagos guardan un respaldo continuo y permiten volver a un momento de los
   últimos días (3 días en el workspace Hobby, 7 en Professional).
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
| `UPLOAD_DIR` | `/var/data/uploads` — **tiene que estar dentro del mount path del disco**. Si el disco se montó en otra ruta (p. ej. `/persistenT`, con las mismas mayúsculas), poné `UPLOAD_DIR=/persistenT/uploads` o cambiá el mount path a `/var/data`. Si en producción quedó afuera y hay un solo disco montado, el sistema usa `<disco>/uploads` y lo avisa; el log de arranque lo muestra (`Boot: UPLOAD_DIR=…`). |
| `BACKEND_URL` | `http://127.0.0.1:8000` |

## 4. Verificación

- `https://<servicio>.onrender.com/api/v1/health` responde `{"status":"ok","env":"production"}`.
- Entrar con el superadmin y crear el primer analista en **Usuarios**.
- **Administración → Sistema** (solo superadmin): estado del almacenamiento. Muestra la base (motor, tamaño), la carpeta
  de archivos en uso y si está en el disco persistente, el espacio libre y, por módulo, qué se puede recalcular sin el
  disco. Si algo se puede perder en el próximo despliegue, lo dice y cómo arreglarlo.

## Qué se guarda dónde

- **PostgreSQL** (servicio aparte, no depende de los despliegues): todas las tablas e informes, y lo necesario para
  recalcularlos: los datos leídos de cada planilla de Ventas Netas, el archivo de cada corte de Productividad y una copia
  comprimida de cada liquidación de Facturación.
- **Disco del servicio web** (`UPLOAD_DIR`): los archivos originales y las fotos de perfil. Render le toma una copia
  automática cada 24 h. Solo persiste lo que está dentro del mount path: el resto del contenedor se borra en cada
  despliegue. Con un disco, cada despliegue deja el servicio sin respuesta unos segundos.

## Emergencias

- Re-correr migraciones: `POST /api/v1/admin/migrate?token=<SECRET_KEY>`.
- Rotar `SECRET_KEY` invalida todas las sesiones activas.

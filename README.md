# Operaciones Voicenter · Gerencia Expansión RM

Plataforma web de la **Gerencia Expansión RM**, operada por **Voicenter S.A.**
Repo interno: `operacionesrafaelmartinez`.

Este repositorio es el **esqueleto** del sistema: login, roles, gestión de
usuarios, auditoría, perfil propio, hub de módulos, Docker y deploy en Render.
Los módulos de negocio se suman sobre esta base (ver
[Cómo agregar un módulo](#cómo-agregar-un-módulo)).

Hereda la identidad visual y la arquitectura de *Operaciones Voicenter*
(proyecto `cobranzasegurossuda`).

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3.12 · FastAPI · SQLAlchemy 2 (async) · Pydantic v2 |
| Base de datos | PostgreSQL 16 (asyncpg). SQLite solo para dev/tests |
| Auth | JWT (access + refresh) · bcrypt · superadmin desde `.env` |
| Frontend | Next.js 14 (App Router, standalone) · React 18 · TypeScript · Tailwind 3 |
| Gráficos | Recharts (instalado, listo para los módulos) |
| Deploy | Docker multi-stage (1 contenedor: FastAPI + Next) · Render |

## Arquitectura

```
                 Puerto público $PORT (8080)
Navegador ──► Next.js (server.js) ──/api/*──► FastAPI (127.0.0.1:8000) ──► PostgreSQL
              páginas + proxy                   auth · users · audit · modules
```

- Un solo contenedor corre los dos procesos (`start.sh`). El navegador solo
  habla con Next; Next reenvía `/api/*` al backend. No hace falta CORS.
- El esquema se crea solo al arrancar (`create_all`). Las columnas nuevas en
  tablas existentes se agregan con `MIGRATIONS_IDEMPOTENT` en `backend/app/main.py`.
- Las fotos de perfil se guardan en `UPLOAD_DIR` (disco persistente en Render).

## Estructura

```
operacionesrafaelmartinez/
├── backend/
│   ├── app/
│   │   ├── main.py              # App, lifespan (schema + migraciones), routers, /health
│   │   ├── core/
│   │   │   ├── config.py        # Settings desde .env
│   │   │   ├── database.py      # Engine async + sesión
│   │   │   ├── security.py      # JWT + bcrypt
│   │   │   ├── rate_limit.py    # Anti fuerza bruta del login
│   │   │   ├── modules.py       # Catálogo de módulos (slugs)
│   │   │   └── logging.py
│   │   ├── api/
│   │   │   ├── deps.py          # CurrentUser, require_superadmin/manager/module
│   │   │   └── v1/              # auth · users · audit · modules
│   │   ├── models/              # User, AuditLog
│   │   ├── schemas/             # Pydantic
│   │   └── services/            # audit_service
│   ├── tests/                   # pytest (SQLite)
│   └── requirements.txt
├── frontend/
│   ├── public/                  # logo-voicenter-color.png
│   └── src/
│       ├── app/                 # login · inicio · perfil · admin/users · admin/audit
│       ├── components/          # AppShell · Brand · Avatar · ConfirmDialog
│       └── lib/                 # api.ts (sesión + refresh automático) · format.ts
├── Dockerfile · start.sh · docker-compose.yml · render.yaml · .env.example
└── docs/deployment-render.md
```

## Roles

| Rol | Dónde vive | Qué puede hacer |
|---|---|---|
| **Superadmin** | `.env` (nunca en DB) | Todo. Gestiona usuarios y ve la auditoría. No edita su perfil desde la app. |
| **Analista** (`analyst`) | DB | Ve todos los módulos. Carga datos y publica (cuando existan módulos). |
| **Lector** (`viewer`) | DB | Solo lectura, sobre los módulos habilitados en `allowed_modules` (`null` = todos). |

En el backend se protege cada endpoint con las dependencias de `api/deps.py`:

```python
Depends(get_current_user)        # cualquier usuario logueado
Depends(require_manager)         # superadmin o analista
Depends(require_superadmin)      # solo superadmin
Depends(require_module("slug"))  # acceso al módulo "slug"
```

## Sistema de login

- `POST /api/v1/auth/login` devuelve access token (60 min) y refresh token (7 días).
- El frontend guarda la sesión en `localStorage` y, ante un 401, renueva el
  access token una vez con `POST /api/v1/auth/refresh`. Si falla, vuelve a `/login`.
- Tras varios intentos fallidos por IP y email, el login responde 429 durante
  `LOGIN_WINDOW_MINUTES`. El contador es en memoria (vale para 1 instancia).
- Todo queda auditado: logins, logins fallidos, altas, bajas, reseteos y cambios de perfil.
- Los usuarios se desactivan (baja lógica); nunca se borran, para conservar la auditoría.

### Endpoints

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/v1/auth/login` | Público |
| POST | `/api/v1/auth/refresh` | Público (refresh token) |
| GET · PATCH | `/api/v1/auth/me` | Logueado |
| POST | `/api/v1/auth/change-password` | Logueado (no superadmin) |
| POST | `/api/v1/auth/me/photo` | Logueado (no superadmin) |
| GET · POST | `/api/v1/users` | Superadmin |
| PATCH · DELETE | `/api/v1/users/{id}` | Superadmin |
| POST | `/api/v1/users/{id}/reset-password` · `/photo` | Superadmin |
| GET | `/api/v1/audit` · `/api/v1/audit/users-map` | Superadmin |
| GET | `/api/v1/modules` | Logueado (filtrado por rol) |
| GET | `/health` · `/api/v1/health` | Público |
| POST | `/api/v1/admin/migrate?token=<SECRET_KEY>` | Emergencia |

La documentación interactiva queda en `http://localhost:8000/docs` al correr el backend.

## Desarrollo local

### Opción A: todo en Docker

```bash
cp .env.example .env
docker compose up --build
# http://localhost:8080  ·  admin@voicenter.com.py / CambiarEstaPassword123!
```

### Opción B: procesos separados (recarga en caliente)

```bash
# 1) Postgres (o usar SQLite cambiando DATABASE_URL en .env)
docker compose up -d db
cp .env.example .env

# 2) Backend
python -m venv .venv
.venv/Scripts/activate            # Windows  (Linux/Mac: source .venv/bin/activate)
pip install -r backend/requirements.txt
cd backend && uvicorn app.main:app --reload --port 8000

# 3) Frontend (otra terminal)
cd frontend && npm install && npm run dev
# http://localhost:3000
```

### Tests

```bash
cd backend && ../.venv/Scripts/python -m pytest -q
cd frontend && npm run typecheck && npm run build
```

## Identidad visual

Paleta oficial Voicenter, definida en `frontend/tailwind.config.js` y `globals.css`:

| Token | Color | Uso |
|---|---|---|
| `brand-primary` | `#E6332A` | Color corporativo, botones, acentos |
| `brand-cyan` | `#00B2BF` | Secundario, estados informativos |
| `brand-purple` | `#662483` | Secundario |
| `brand-orange` | `#F39200` | Secundario, degradé del login |
| `brand-ink` | `#0F1116` | Titulares |

Tipografías: **Barlow Condensed** para titulares (sustituto de DIN) y
**Manrope** para texto (sustituto de Gilroy). Clases utilitarias listas:
`btn-primary`, `btn-secondary`, `btn-ghost`, `btn-danger`, `input`, `card`,
`label`, `badge-*`, `nav-link`. Incluye estilos de impresión A4 horizontal
con portada corporativa (`print-cover`) y membrete (`print-header`).

## Cómo agregar un módulo

1. **Catálogo**: sumar el módulo en `backend/app/core/modules.py` con `available: True`.
2. **Modelos**: crear `backend/app/models/<modulo>.py` e importarlo en `models/__init__.py`.
3. **API**: crear `backend/app/api/v1/<modulo>.py` con
   `Depends(require_module("<slug>"))` y montarlo en `main.py`.
4. **Frontend**: crear `frontend/src/app/<slug>/page.tsx` envuelto en `<AppShell>`
   y agregar su ruta en `MODULE_HREF` de `src/app/inicio/page.tsx`.
5. **Tests**: agregar `backend/tests/test_<modulo>.py`.

## Deploy en Render

Ver [docs/deployment-render.md](docs/deployment-render.md). En resumen: crear
la base PostgreSQL, crear el Web Service con runtime Docker y disco en
`/var/data`, y setear `DATABASE_URL`, `SECRET_KEY`, `SUPERADMIN_EMAIL` y
`SUPERADMIN_PASSWORD`. `DATABASE_URL` se convierte sola a `postgresql+asyncpg://`.

## Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). Las obligatorias en producción:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Connection string de PostgreSQL |
| `SECRET_KEY` | Firma de los JWT. 64 caracteres hex aleatorios |
| `SUPERADMIN_EMAIL` | Email del superadmin |
| `SUPERADMIN_PASSWORD` o `SUPERADMIN_PASSWORD_HASH` | Credencial del superadmin |

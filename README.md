# Operaciones Voicenter · Gerencia Expansión RM

Plataforma web de la **Gerencia Expansión RM**, operada por **Voicenter S.A.**
Repo interno: `operacionesrafaelmartinez`.

Este repositorio es el **esqueleto** del sistema: login, operativas, perfiles con
permisos configurables, gestión de usuarios, auditoría, perfil propio, hub de operativas, Docker y deploy en Render.
Las operativas se suman sobre esta base (ver
[Cómo agregar una operativa](#cómo-agregar-una-operativa)).

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
              páginas + proxy                   auth · users · perfiles · operativas
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
│   │   │   ├── operativas.py    # Catálogo de operativas y utilidades
│   │   │   ├── perfiles.py      # Perfiles y permisos iniciales
│   │   │   └── logging.py
│   │   ├── api/
│   │   │   ├── deps.py          # CurrentUser, require_superadmin, require_perm
│   │   │   └── v1/              # auth · users · perfiles · audit · operativas (plataforma)
│   │   ├── models/              # User, Profile, AuditLog, Agente (plataforma)
│   │   ├── schemas/             # Pydantic (plataforma)
│   │   ├── jobs/                # queue.py (cola genérica) · isolated.py (subproceso aislado)
│   │   ├── services/            # audit · agent (motor del agente IA, compartido)
│   │   └── operativas/          # código de cada operativa (ROUTERS + WORKERS)
│   │       └── televentas_claro/
│   │           ├── router.py    # portada de la operativa
│   │           ├── ventas_netas/ # submódulo: api · models · schemas · parser · analyzer · exports · jobs
│   │           └── facturacion/ # submódulo: api · agent_api · models/ · schemas
│   │                            #   parser · analyzers/ · agent/ · jobs/
│   ├── tests/                   # pytest (SQLite)
│   └── requirements.txt
├── frontend/
│   ├── public/                  # logo-voicenter-color.png
│   └── src/
│       ├── app/                 # login · inicio · televentas-claro · perfil · admin/*
│       ├── components/          # AppShell · Brand · Avatar · ConfirmDialog
│       └── lib/                 # api.ts (sesión + refresh) · operativas.ts · format.ts
├── Dockerfile · start.sh · docker-compose.yml · render.yaml · .env.example
└── docs/deployment-render.md
```

## Operativas, perfiles y permisos

El sistema se organiza en **operativas**: módulos independientes, cada uno con
sus propias **utilidades**. La primera operativa es **Televentas CLARO**.

| Concepto | Dónde se define | Quién lo cambia |
|---|---|---|
| Operativas y sus utilidades | `backend/app/core/operativas.py` | Desarrollo |
| Perfiles (Coordinador, Supervisor, Analista, Cliente) | `backend/app/core/perfiles.py` | Desarrollo |
| Utilidades de cada perfil | Tabla `profiles`, pantalla **Administración → Perfiles** | Superadmin |
| Perfil y operativas de cada usuario | Pantalla **Administración → Usuarios** | Superadmin |

Cada utilidad es un permiso con la forma `<operativa>.<utilidad>`, por ejemplo
`televentas_claro.ventas_netas`. Un usuario puede usar una utilidad solo si se cumplen las tres condiciones:

1. Su perfil tiene la utilidad.
2. Su perfil tiene el acceso a la operativa (`<operativa>.ver`).
3. La operativa está asignada al usuario.

El **superadmin** vive en `.env`, ve todas las operativas y tiene todos los
permisos. Es el único que gestiona usuarios, perfiles y auditoría. Los
cambios de permisos se aplican en la siguiente request, sin volver a loguearse.

Utilidades iniciales de Televentas CLARO y permisos sembrados la primera vez
(el superadmin los ajusta después):

| Utilidad | Coordinador | Supervisor | Analista | Cliente |
|---|:-:|:-:|:-:|:-:|
| Acceso a la operativa | ✓ | ✓ | ✓ | ✓ |
| Ventas Netas | ✓ | ✓ | ✓ | |
| Facturación | Solo superadmin | | | |

Las utilidades marcadas `solo_superadmin` en el catálogo (hoy: **Facturación**)
no se pueden asignar a ningún perfil: la matriz las muestra bloqueadas, la API
rechaza el cambio y, aunque figuren en la base, no se hacen efectivas. A los
demás usuarios ni siquiera se les listan. Para delegarlas más adelante alcanza
con quitar la marca en `core/operativas.py`.

En el backend cada endpoint se protege con el permiso de su utilidad:

```python
Depends(get_current_user)                        # cualquier usuario logueado
Depends(require_superadmin)                      # solo superadmin
Depends(require_perm("televentas_claro.ventas_netas")) # utilidad concreta
```

En el frontend, `useSession().can("televentas_claro.ventas_netas")` muestra u oculta
controles. Es solo cosmético: el backend valida siempre.

## Televentas CLARO · Ventas Netas

Ventas cerradas del mes a partir del **corte diario** que envía Claro: un
`.xlsx` con las hojas `DDI` (líneas activadas), `CARGAS` (ventas cargadas) y
`PORTABILIDAD` (Pospago portado). Código en
`backend/app/operativas/televentas_claro/ventas_netas/`.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Informes | `/televentas-claro/ventas-netas` | Informes agrupados por mes: publicado, borradores y reemplazados |
| Subir corte | `…/upload` | Sube el `.xlsx`; se procesa en cola y genera un borrador |
| Informe | `…/reports/{id}` | **Visión Negocio** (netas, gerencial), **Productividad** (evolutivo de cargas, estados, Pospago vs Internet, zonas, vendedores) y **Visión Operativa** (planillas, críticos, ficha por vendedor, descargable) |

Reglas del análisis (`analyzer.py`):

- **Netas** = filas de DDI del período. El **período es el mes de la fecha de
  activación/venta** (el mayoritario del archivo), no el de la carga.
- **Uso**: `CONSUMO_DATOS` solo aplica a Pospago. Una línea sin uso es alerta
  de posible PFI. Un vendedor entra en alerta con ≥ 5 líneas y < 50 % en uso.
- **Vendedor** de una neta = `POS_NOMBRE` sin el prefijo del subcanal; las
  cargas pendientes no traen POS y se atribuyen por `VENDEDOR_LEGAJO`.
- Suspendidas y portadas que no llegaron a DDI se cuentan y se marcan, no se descartan.
- **Productividad** (hoja CARGAS): evolutivo por fecha de alta de la venta,
  estados (finalizada, a confirmar, procesado, rechazada), Pospago (CO) vs
  Internet (IF) e IPTV, y **zonas**: Capital y Central por un lado, Interior por
  el otro (`DEPARTAMENTO_FACT`). Las cargas pendientes no traen POS: se
  atribuyen al vendedor cuando el legajo que cargó siempre carga para un único
  POS; si no, quedan como "cargado por <legajo>".

Publicación (`api.py`):

- Cada corte genera un **borrador**; solo lo ve quien tiene *Gestión*.
- **Una publicación por mes.** Publicar sobre un mes que ya tiene una exige
  `confirm_replace=true` (la API responde `409 replace_required` y la pantalla
  pide confirmación). El anterior queda como **Reemplazado** en el historial.
- Los demás perfiles ven solo el publicado. Un publicado no se elimina: hay que despublicarlo antes.
- Todo queda auditado (subida, publicación, reemplazo, despublicación, eliminación, descarga).

Utilidades: `ventas_netas` (ver informes publicados y descargar) y
`ventas_netas_gestion` (subir, publicar, reemplazar, eliminar); por defecto la
segunda solo la tiene el Analista.

## Televentas CLARO · Facturación (solo superadmin)

Liquidación de comisiones de Claro (Telemarketing Fijo PGY), portada desde
*Operaciones Voicenter* (`cobranzasegurossuda`) sin cambios de lógica.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Reportes | `/televentas-claro/facturacion` | Liquidaciones cargadas, publicar y eliminar |
| Subir liquidación | `…/upload` | Sube el `.txt` (cp1252, `;`) a la cola de procesamiento |
| Reporte | `…/reports/{id}` | Conceptos, drivers, ventas, suspensiones PFI, documentación, mix de planes |
| Comparar | `…/compare` | Matriz por concepto y descomposición del cambio entre meses |
| Simulador | `…/simulador` | Una cohorte de ventas: facturación del mes, retención a 6 y 12 meses, margen |
| Simulador anual | `…/simulador-anual` | Proyección a 12 o 18 meses multicohorte, con registro de simulaciones |
| GPON | `…/gpon` | El simulador anual con el motor y las variables del negocio fibra + TV |
| Criterios | `…/criterios` | Reglas de liquidación sobre un escenario fijo |
| Agente IA | `…/agente` | Analista de facturación sobre los reportes (requiere `OPENAI_API_KEY`) |

Todo el código vive en `backend/app/operativas/televentas_claro/facturacion/`.

- **Procesamiento:** el endpoint solo guarda el archivo; un worker supervisado
  reclama cada carga y la parsea en un **subproceso aislado** con timeout, para
  que un archivo malo no pueda tumbar la API (`jobs/queue.py`).
- **Lógica:** parser en `parser.py`; análisis, comparativo y simuladores en
  `analyzers/`. Los simuladores tienen tests calibrados con liquidaciones reales.
- **API:** `/api/v1/televentas-claro/facturacion/*` y
  `/api/v1/televentas-claro/facturacion-agent/*`, todo con `require_perm("televentas_claro.facturacion")`.

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
| GET · PUT | `/api/v1/perfiles` · `/api/v1/perfiles/{perfil}` | Superadmin |
| GET | `/api/v1/perfiles/catalogo` | Superadmin |
| GET | `/api/v1/operativas` | Logueado (solo las que puede abrir) |
| GET | `/api/v1/televentas-claro` | `televentas_claro.ver` |
| GET | `/api/v1/televentas-claro/ventas-netas/reports[/{id}][/export.xlsx]` | `televentas_claro.ventas_netas` |
| POST · DELETE | `/api/v1/televentas-claro/ventas-netas/uploads` · `/reports/{id}[/publish\|/unpublish]` | `televentas_claro.ventas_netas_gestion` |
| * | `/api/v1/televentas-claro/facturacion/*` · `/facturacion-agent/*` | Solo superadmin |
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

## Cómo agregar una operativa

1. **Catálogo**: sumarla en `backend/app/core/operativas.py` con sus utilidades
   (la primera siempre `ver`). Opcional: permisos iniciales en `core/perfiles.py`.
2. **Backend**: paquete `backend/app/operativas/<slug>/` con su `router.py`
   (portada, `require_perm("<slug>.ver")`) y una carpeta por submódulo
   (`api.py`, `models/`, `schemas.py`, lógica y `jobs/`). Cada endpoint con
   `require_perm("<slug>.<utilidad>")`. El `__init__.py` de la operativa
   expone `ROUTERS` y `WORKERS`; se registra sumándola a `_MODULOS` en
   `app/operativas/__init__.py`, y `main.py` monta todo solo.
3. **Compartido**: lo que sirve a más de una operativa (auditoría, motor del
   agente IA, ejecución aislada) queda en `services/` y `jobs/`.
4. **Frontend**: páginas en `frontend/src/app/<ruta>/` envueltas en `<AppShell>`
   y la ruta en `frontend/src/lib/operativas.ts`. Cada utilidad con pantalla
   propia es un **submódulo** (`submodulos`): la barra de la operativa muestra
   solo *Inicio* y un acceso por submódulo; la navegación interna del submódulo
   (su `nav`) aparece recién al entrar en él, con vuelta a la operativa. Todas
   las rutas bajo el `href` del submódulo exigen su utilidad.
5. **Tests**: `backend/tests/test_<operativa>.py`.

Para sumar una **utilidad** a una operativa existente alcanza con agregarla a
su lista. Aparece sola en la matriz de perfiles, desmarcada para todos.

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

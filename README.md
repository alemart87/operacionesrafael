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
│   │   ├── models/              # User, Profile, AuditLog, Agente, MigracionDatos (plataforma)
│   │   ├── schemas/             # Pydantic (plataforma)
│   │   ├── jobs/                # queue.py (cola genérica) · isolated.py (subproceso aislado)
│   │   ├── services/            # audit · agent (motor del agente IA, compartido)
│   │   ├── asistente/           # Voi (Claude Managed Agents): claude/ (agente, entorno, habilidades) · herramientas/ · conocimiento
│   │   │                        #   publicacion · sesiones · consumidor · memoria · consumo · api · admin_api · simulador
│   │   └── operativas/          # código de cada operativa (ROUTERS + WORKERS)
│   │       └── televentas_claro/
│   │           ├── router.py    # portada de la operativa
│   │           ├── fuentes.py   # qué informe de Productividad / Ventas Netas vale cada día y cada mes
│   │           ├── ventas_netas/ # submódulo: api · models · schemas · parser · analyzer · exports · jobs
│   │           ├── sph/         # submódulo SPH estimado: api · models · analyzer
│   │           ├── supervision/ # submódulo Supervisión: api · coaching_api · tickets_api · comando_api · models · calculo · scoring · coaching · impacto · alertas · tickets · sla · comando · operadores · migraciones
│   │           ├── informe_diario/ # informe diario: api · models · informe (reglas y firma) · importar · palabras · seguimiento · pdf · migraciones
│   │           └── facturacion/ # submódulo: api · agent_api · models/ · schemas
│   │                            #   parser · analyzers/ · agent/ · jobs/
│   ├── tests/                   # pytest (SQLite)
│   └── requirements.txt
├── frontend/
│   ├── public/                  # logo-voicenter-color.png
│   └── src/
│       ├── app/                 # login · inicio · televentas-claro · perfil · admin/*
│       ├── components/          # AppShell · Brand · Avatar · ConfirmDialog · voi/ (panel, isotipo, consola)
│       └── lib/                 # api.ts (sesión + refresh) · operativas.ts · format.ts · voi.ts (API y SSE de Voi)
├── Dockerfile · start.sh · docker-compose.yml · render.yaml · .env.example
└── docs/deployment-render.md
```

## Operativas, perfiles y permisos

El sistema se organiza en **operativas**: módulos independientes, cada uno con
sus propias **utilidades**. La primera operativa es **Televentas CLARO**.

| Concepto | Dónde se define | Quién lo cambia |
|---|---|---|
| Operativas y sus utilidades | `backend/app/core/operativas.py` | Desarrollo |
| Perfiles (Sub gerente, Controller, Coordinador, Supervisor, Analista, Auditor, Cliente) | `backend/app/core/perfiles.py` | Desarrollo |
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
(el superadmin los ajusta después). Una utilidad nueva aparece desmarcada en los
perfiles que ya existen: el superadmin la asigna en **Administración → Perfiles**,
salvo que venga con una **migración de datos de una sola vez** (`MIGRACIONES_DATOS`,
tabla `migraciones_datos`): así se dieron las utilidades de Supervisión a los perfiles
existentes según el modelo definido, y no se repite aunque el superadmin las cambie.

| Utilidad | Sub gerente | Controller | Coordinador | Supervisor | Analista | Auditor | Cliente |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Acceso a la operativa | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ventas Netas · Ver / Gestión | ✓ / ✓ | ✓ / ✓ | ✓ / | 🔒 | ✓ / ✓ | ✓ / | |
| Productividad · Ver / Gestión | ✓ / ✓ | ✓ / ✓ | ✓ / | 🔒 | ✓ / ✓ | | |
| SPH · Ver / Gestión | ✓ / ✓ | ✓ / ✓ | ✓ / | 🔒 | ✓ / ✓ | | |
| Supervisión · Ver / Gestión | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | 🔒 | ✓ / | ✓ / | |
| Supervisión · Tickets de revisión | ✓ | ✓ | ✓ | 🔒 | | ✓ | |
| Supervisión · Parámetros del modelo (restringida) | ✓ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Operadores · Vincular | ✓ | ✓ | ✓ | 🔒 | ✓ | | |
| Informe diario | ✓ | | ✓ | 🔒 | | | |
| Portal del supervisor (restringida) | 🔒 | 🔒 | 🔒 | ✓ | 🔒 | 🔒 | 🔒 |
| Auditoría de ventas | ✓ | ✓ | | 🔒 | ✓ | ✓ | |
| Facturación (restringida) | ✓ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |
| Asistente IA (Voi) | ✓ | | ✓ | 🔒 | | ✓ (modo auditoría) | |

- **Sub gerente:** todos los módulos, incluida Facturación.
- **Controller:** todos los módulos menos Facturación (el informe diario y el asistente no vienen por
  defecto, pero se le pueden asignar); como cualquier usuario, puede tener varias operativas asignadas.
- **Supervisor:** solo entra a **su portal** (`PERFILES_SOLO_PORTAL`): únicamente puede
  tener las utilidades marcadas `portal` (el acceso y el Portal del supervisor). Al
  iniciar sesión va directo al portal; cualquier otra ruta lo devuelve ahí.
- **Auditor:** revisa ventas y casos (Auditoría y Ventas Netas), envía tickets de revisión
  a los supervisores y ve el tablero de Supervisión en lectura.

Las utilidades con `solo_perfiles` en el catálogo son **restringidas**: además del
superadmin, solo las pueden tener los perfiles listados (hoy: **Facturación → Sub
gerente**). La matriz las muestra bloqueadas para el resto, la API rechaza el cambio
y, aunque figuren en la base, no se hacen efectivas; a los demás usuarios ni
siquiera se les listan. Con la lista vacía son exclusivas del superadmin. La
administración (usuarios, perfiles, auditoría y seguridad) sigue siendo solo del
superadmin.

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
  cargas pendientes no traen POS: se atribuyen por su línea activada o por `VENDEDOR_LEGAJO`.
- Suspendidas y portadas que no llegaron a DDI se cuentan y se marcan, no se descartan.
- **En espera de uso**: una Pospago sin consumo activada hace menos de 3 días al
  corte (`DIAS_ESPERA_USO`) todavía no tuvo tiempo de usarse. No es alerta: no
  cuenta como sin uso en ningún porcentaje, alerta de vendedor, críticos, riesgo ×
  uso ni "día con más sin uso"; se marca "◷ En espera" en todas las tablas y se
  evalúa en el corte siguiente. Auditoría usa el mismo criterio (lo importa del
  analizador). Al arrancar, la plataforma recalcula sola, desde los datos
  guardados, los informes generados por una versión anterior del análisis.
- **Sali Hablando** (`PORTACION_TIPO = SI-SaliHbl`): la línea salió hablando de
  la otra operadora. Suelen activarse el mes anterior y completar la portación
  en el período, por lo que no figuran en DDI ni en CARGAS del mes; el
  evolutivo usa la fecha de portación. Se revisan por día, vendedor y línea,
  con el uso de cada una (casi todas sin uso: alerta PFI).
- **Productividad** (hoja CARGAS): evolutivo por fecha de alta de la venta,
  estados (finalizada, a confirmar, procesado, rechazada), Pospago (CO) vs
  Internet (IF) e IPTV, y **zonas**: Capital y Central por un lado, Interior por
  el otro (`DEPARTAMENTO_FACT`). Las cargas pendientes no traen POS: se
  atribuyen al vendedor de su línea ya activada (el mismo SDS en DDI o
  PORTABILIDAD); si todavía no se activó, al del legajo que cargó cuando ese
  legajo siempre carga para un único POS; si no, quedan como "cargado por
  <legajo>". Las canceladas administrativamente (`SDS_CANC_ADM`) quedan marcadas.

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

## Televentas CLARO · Productividad de llamadas

Informe diario de productividad del call center a partir del reporte **Tiempos
Acumulados** de la plataforma de discado (CSV, una fila por agente con los
totales acumulados desde las 00:00 hasta la hora del export). Código en
`backend/app/operativas/televentas_claro/productividad/`.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Informes diarios | `/televentas-claro/productividad` | Un informe por fecha de gestión, metas vigentes, publicar/despublicar |
| Subir cortes | `…/productividad/subir` | Varios CSV a la vez; fecha y hora de cada corte detectadas del nombre. Pantalla «Procesando» y, al terminar, abre el informe del día |
| Informe del día | `…/productividad/informes/{id}` | Resumen gerencial, agentes, por horario, cortes del día |
| Acumulado | `…/productividad/acumulado` | Semana, mes o rango con los días publicados |

- **Fecha de gestión automática:** sale de la marca de tiempo del nombre
  (`Tiempos_Acumulados_1791406800981.csv` = 07/10/2026 18:00, hora de Asunción).
  Si el nombre no la trae, se pide al subir.
- **Cortes e intradía:** cada archivo es un corte acumulado. Con un corte por día
  hay informe diario, semanal y mensual; con varios (ideal: uno por hora) la
  diferencia entre cortes da la curva por horario y separa los turnos (corte cerca
  del cambio de turno, 13:00 por defecto). Subir otra vez la misma hora reemplaza
  ese corte. Un acumulado que baja respecto del corte anterior se avisa.
- **Meta de conversación:** conversación ÷ tiempo conectado, meta 37–47%, rojo
  debajo de 25% (clic en el semáforo → lista de agentes de esa banda).
- **Contacto:** llamada con 30 s o más de conversación (parámetro). Se mide con
  la columna «Short Talk < Ns» del umbral de la regla (el reporte puede traer
  varias). Si el archivo no la trae (hoy solo «< 10s»), el contacto no se muestra
  y la pantalla indica qué hace falta. Si la plataforma informa **más cortas que
  llamadas** en un agente (cuenta «Short Talk» con otra regla que «Out»), el
  archivo no se rechaza: se toman todas sus llamadas como cortas y queda una nota
  al subirlo y en el informe del día.
- **Discador automático vs. manual:** se detecta por agente (con tiempo de
  tipificación = automático).
- **Sesiones abiertas:** 12 h o más conectado = alerta; no entran en la meta ni en
  la jornada media (sus llamadas sí).
- **Totales:** siempre sumando tiempos y llamadas; nunca promediando porcentajes.
- **Publicación:** igual que Ventas Netas, por día: cada corte actualiza el
  borrador del día; uno publicado por día; reemplazar pide confirmación; un
  publicado no cambia (recalcular genera un borrador nuevo). Los acumulados usan
  solo días publicados.
- **Parámetros** (meta, rojo, contacto, sesión abierta, cambio de turno, ranking):
  los ve todo el módulo y los cambia solo el superadmin.
- **Permisos:** `televentas_claro.productividad` (ver publicados y acumulados) y
  `televentas_claro.productividad_gestion` (subir, borradores, publicar, recalcular, eliminar).

## Televentas CLARO · SPH estimado

SPH = **ventas del día** por hora conectada. Cruza dos módulos que ya existen, sin subir
archivos nuevos: las horas de los informes de **Productividad** y la **hoja de
productividad** (CARGAS) de la planilla de **Ventas Netas** del mes. No usa las netas.
Código en `backend/app/operativas/televentas_claro/sph/`.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Informes SPH | `/televentas-claro/sph` | **Calcular SPH** por día, semana, mes o rango (ver qué días cuentan y qué falta subir), filtros por tipo, publicar/despublicar |
| Informe | `…/sph/informes/{id}` | SPH de la operación, ventas por estado, SPH por día (períodos), ranking por asesor, cruce de nombres, ventas sin asesor, tabla de asesores (CSV) |
| Vínculos | `…/sph/vinculos` | Vínculos agente → vendedor corregidos a mano |

- **Períodos:** un día, una semana (lunes a domingo), un mes o un rango de hasta 62
  días. Se suma día por día: **cuenta** cada día con informe de Productividad y que el
  corte de ventas de su mes ya alcanza; los demás se informan (y el mes en curso se
  puede recalcular a medida que llegan datos). Cada venta se atribuye al asesor solo
  los días en que estuvo conectado.
- **Fuentes** (`fuentes.py`, las mismas que usa Supervisión): cada planilla de Ventas Netas
  trae las ventas de todo el mes hasta su corte, así que **la de corte más nuevo reemplaza
  a las anteriores**, publicada o no (a igual corte, la publicada). De las llamadas, el
  informe del día que llega más lejos (corte final más tardío; a igual corte, el
  publicado): un día publicado a mitad de jornada no deja afuera las horas de la tarde.
  Si se usó un borrador, queda avisado.
- **Ventas del día:** las cargadas ese día (fecha de alta) en la hoja de productividad
  de la planilla del mes del día, en el estado en que estén: **finalizadas** (aprobadas),
  **a confirmar** o **procesadas**. No cuentan las **rechazadas** ni las **canceladas
  administrativamente** (`SDS_CANC_ADM`: figuran finalizadas pero no se activan). Se cruzan
  con las horas de **ese mismo día**: las llamadas del 10/10 van contra las ventas del 10/10
  que trae la planilla subida el 11/10 (corte del 10), aunque todavía no esté publicada.
  **No se usan las netas** (líneas activadas): se activan días después y llegan en la
  planilla del mes de la activación, que puede ser otro. Cada planilla nueva trae el
  último estado de cada venta (una pendiente que se rechaza deja de contar al recalcular):
  el informe avisa que hay datos más nuevos, muestra las ventas por estado y avisa si la
  planilla se subió el mismo día que cuenta (puede no traer el día completo).
- **Vendedor de cada venta:** el POS de la carga; las pendientes no lo traen y se
  atribuyen al vendedor de su **línea ya activada** (mismo SDS en DDI o PORTABILIDAD) o al
  del legajo que la cargó si ese legajo carga para un único POS (lo resuelve Ventas Netas).
  Si no (un legajo que carga para varios vendedores), no se sabe quién la vendió: cuenta
  en el SPH de la operación y se informa aparte.
- **SPH de la operación:** ventas ÷ horas conectadas del equipo, sin sesiones
  abiertas (ni sus horas ni sus ventas). No depende del cruce de nombres.
- **Cruce de nombres (sin ID común):** el agente de la plataforma («APELLIDO,
  NOMBRE») se vincula con el vendedor del POS de Claro por su primer nombre y un
  apellido. **Exacto** (están todas sus palabras), **probable** (falta alguna,
  cambia la escritura o el apellido puede ser el segundo), **ambiguo** (empate: no
  se adivina) o **sin cruce**. Uno a uno: un vendedor no va a dos agentes.
- **SPH por asesor (estimado):** ventas del vendedor vinculado ÷ horas del agente;
  entra al ranking con 2 h conectadas o más en un día y 6 h (una jornada) en un período.
- **SPH anteriores (hasta la v3):** se calcularon con las netas. No cambian (un publicado
  nunca cambia): la lista y el informe los marcan como «netas» y, al recalcularlos, se
  genera un borrador con las ventas del día.
- **Vínculos:** el cruce sale del **maestro de operadores** de Supervisión (fuente única,
  mismo motor de cruce): antes de calcular se detectan los agentes y vendedores del mes.
  Gestión confirma, corrige o descarta cada vínculo desde el SPH o desde Supervisión →
  Operadores; vale para los dos y para los próximos cálculos.
- **Publicación:** como Productividad, uno publicado por período (el SPH del día y el
  de su semana se publican por separado), reemplazo con confirmación y un publicado
  no cambia (recalcular genera un borrador). El informe avisa si hay datos más nuevos.
- **Permisos:** `televentas_claro.sph` (ver publicados) y `televentas_claro.sph_gestion`
  (calcular, borradores, vínculos, publicar, recalcular, eliminar).

## Televentas CLARO · Supervisión (modelo Líder Coach Comercial)

Gestión de los supervisores como líderes coach: equipos del mes, objetivos de Pospago y
GPON por supervisor, avance y **proyección al cierre**, y asesores en alerta por líneas
sin uso. Código en `backend/app/operativas/televentas_claro/supervision/`; la guía del
modelo es el documento «Modelo Líder Coach Comercial». Las 5 fases están habilitadas:
equipos, objetivos y proyección; tablero y scoring; coaching y bitácora; tickets de revisión
con SLA; y el centro de comandos de los jefes.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Centro de comandos | `…/supervision/comando` | El día de la operación: cabecera (score, avance y proyección, % sin uso contra el umbral, supervisores en crítico, líneas a recuperar, tickets y cobertura de coaching), **semáforo de supervisores** con sus motivos y **alertas del día** (tomar y anotar qué se hizo, **pedir revisión** con un clic, descartar con el motivo); rutina de seguimiento |
| Objetivos y proyección | `/televentas-claro/supervision` | Por supervisor: vendido / objetivo, proyección al cierre, ritmo necesario por día hábil, semáforo y alertas; la operación completa; **Cargar objetivos** en la misma tabla |
| Tablero | `…/supervision/tablero` | Scoring 0–100 de la operación, ranking de supervisores y de asesores, con la tendencia contra el mes anterior |
| Coaching | `…/supervision/coaching` | Gestión de coaching de todos los supervisores: cobertura, foco, seguimientos, coachings, vencidos y última actividad (primero, quien tiene algo vencido) |
| Registro de coaching | `…/supervision/coaching/registro` | **Todos los coachings y seguimientos por rango de fechas** (este mes, mes anterior, 7, 30 o 90 días, este año o libre, hasta 400 días): qué se trabajó (diagnóstico), el compromiso, la **devolución del seguimiento** y el resultado medido por métrica. Filtros por supervisor, asesor, métrica, tipo, seguimiento (pendientes, próximos, vencidos, a tiempo, tarde), resultado y anulados; indicadores del rango, desglose **por métrica, por supervisor y por asesor** (un clic filtra), búsqueda en los textos, detalle con historial y aclaraciones, CSV e impresión. Los filtros quedan en la URL (para compartir la vista) |
| Tickets | `…/supervision/tickets` | Tickets de revisión: **Enviar ticket**, bandeja (abiertos o los del mes, primero lo vencido), detalle con historial (comentar, mandar los datos pedidos, reabrir, reasignar, cancelar) y métricas por supervisor |
| Detalle del supervisor | `…/supervision/supervisores/{id}` | Lo mismo que ve el supervisor en su portal, para los jefes (imprimible); pestañas **Coaching y bitácora** (`…/{id}/coaching`, solo lectura), **Tickets** (`…/{id}/tickets`) y **Línea de tiempo** (`…/{id}/linea`: coachings, seguimientos, notas, tickets, cambios de equipo, objetivos y alertas, lo más nuevo primero) |
| Ficha del asesor | `…/supervision/asesores/{id}` | Del supervisor al asesor y del asesor a sus líneas y tickets: equipo del mes, puntaje y componentes, ventas y uso (líneas sin uso), alertas de uso, coachings, tickets y notas de bitácora |
| Equipos del mes | `…/supervision/equipos` | Tablero por supervisor y «Sin supervisor»; selección múltiple, **fecha efectiva**, copiar los equipos del mes anterior |
| Operadores | `…/supervision/operadores` | Maestro de operadores: por revisar, vincular, separar, confirmar sin vínculo, renombrar, dar de baja |
| Calendario | `…/supervision/calendario` | Cuánto vale cada día de la semana, días no laborables (más los feriados de Seguridad) y el **horario de atención** (horas hábiles de los plazos de los tickets) |
| Parámetros | `…/supervision/parametros` | Pesos y umbrales del scoring, versionados (solo sub gerente y superadmin) |
| Mi portal | `/televentas-claro/portal` | El portal del supervisor: «Para hoy» (seguimientos vencidos, de hoy y **próximos** —los de los próximos 2 días hábiles—, alertas y tickets por atender) con el botón **Hacer coaching**, su equipo (con «Coaching» en cada asesor), sus objetivos, avance y proyección, asesores en alerta y sus líneas sin uso |
| Coaching y bitácora | `/televentas-claro/portal/coaching` | El supervisor registra coachings (con compromiso y fecha de seguimiento), seguimientos con el impacto medido, aclaraciones y notas de bitácora; ve su gestión del mes. **Hacer coaching** es la acción principal: brilla con un pulso (fijo si el sistema pide menos movimiento), queda flotante al bajar por la página y cada asesor sin coaching del mes lo tiene destacado |
| Mi historial | `/televentas-claro/portal/historial` | El registro por rango de fechas, solo con lo del supervisor: sus coachings, compromisos, devoluciones y resultados, con los mismos filtros, indicadores y CSV |
| Tickets (portal) | `/televentas-claro/portal/tickets` | La bandeja del supervisor: responde, pide datos y resuelve los tickets que le envían, con sus plazos |

- **Maestro de operadores:** cada persona tiene un nombre en llamadas (agente de
  Productividad) y otro como vendedor (POS de Ventas Netas), sin ID común. En cada mes
  se detectan los dos y se cruzan por nombre con el motor del SPH; lo pendiente se
  vincula a mano y lo que decide una persona no lo cambia el cruce automático. Unir dos
  operadores que ya tienen equipo lo decide una persona. La detección se rehace sola
  cuando cambian los informes del mes (firma de las fuentes). El legajo solo se toma si
  identifica a un único vendedor (el de Ventas Netas es el de quien cargó la venta).
- **Equipos del mes:** asignación supervisor → asesores por mes, con fecha efectiva para
  los cambios a mitad de mes (`sup_equipo_asignaciones`). Cada neta cuenta para el
  supervisor que tenía al asesor el día de la venta (si se vendió antes del mes, el del
  día 1). Asignan los jefes (`supervision_gestion`); cada cambio queda auditado.
- **Objetivos:** Pospago y GPON por supervisor y mes (`sup_objetivos`), los cargan los
  jefes; el supervisor los ve y no los puede cambiar.
- **Netas del mes:** las del informe de Ventas Netas del mes (mes de activación: la cifra
  oficial). Fuente: la planilla de corte más nuevo (cada una trae todo el mes y reemplaza a
  la anterior); si todavía no se publicó, se marca como provisoria.
- **Proyección al cierre** = vendido al corte ÷ días hábiles transcurridos × días hábiles
  del mes; **ritmo necesario** = lo que falta ÷ días hábiles restantes. Días hábiles: de
  lunes a viernes 1, sábado 0,5, domingo 0 (en septiembre el sábado vendió el 44% de un
  día de semana), sin feriados ni días no laborables. Con menos de 3 días hábiles es
  provisoria. Semáforo: en camino ≥ 100% del objetivo, en riesgo ≥ 90%, bajo objetivo.
- **Supervisor crítico:** al menos un asesor de su equipo actual con más del 10% de sus
  Pospago evaluables sin uso y 5 o más evaluables. **Líneas a recuperar:** las sin uso
  que tienen que empezar a usarse para volver al 10%.
- **Scoring v1** (`supervision/scoring.py`, cuentas puras):
  - Asesor: Pospago 35, uso de líneas 25, conversación 25 y GPON 15, con puntos lineales
    entre dos extremos. Pospago y GPON se miden contra el objetivo de referencia al corte:
    la parte del objetivo del equipo según los días que trabajó (días con conexión en
    Productividad, escalados si faltan informes). Uso: completo con 10% sin uso o menos,
    cero con 35%. Conversación: con las metas de Productividad (completo desde 37%, cero
    con 25%; más de 47% no resta y se marca).
  - Lo que no tiene datos suficientes no se evalúa y su peso se reparte. Si se evaluó
    menos del 60% del peso, el puntaje es **parcial** (se marca y va después en el ranking).
  - Supervisor: 60 por el resultado del equipo y 40 por la gestión: cobertura 15 (% del
    equipo actual con al menos un coaching en el mes), foco 10 (% de las alertas de uso con
    coaching sobre uso dentro de los 5 días hábiles desde que aparecieron; las que siguen en
    plazo o se resolvieron solas antes no cuentan), seguimientos 5 (% de los compromisos
    seguidos en la fecha acordada o al día siguiente) y tickets 10 (% de los tickets del mes
    respondidos y resueltos en plazo). La gestión se mide desde el día en que se instaló el registro de coaching
    (`gestion_desde`, migración de datos): los meses anteriores no se reescriben. Operación:
    los mismos componentes sobre toda la operación. Tendencia: contra el mes anterior.
  - Los pesos los cambia el sub gerente (utilidad restringida `supervision_parametros`);
    cada cambio es una versión nueva con historial y auditoría.
- **Coaching y bitácora** (`supervision/coaching.py`, `coaching_api.py`; tablas
  `sup_coachings`, `sup_coaching_eventos`, `sup_bitacora`, `sup_alertas`):
  - Lo registra el supervisor desde su portal, solo para los asesores que tenía en su
    equipo ese día (lo controla el servidor): asesor, fecha, tipo (diario en puesto,
    semanal uno a uno, mensual de resultados), **una o varias métricas** (Pospago, GPON, uso
    de líneas, conversación u otra; por ejemplo Pospago + GPON), diagnóstico, compromiso y
    fecha de seguimiento (hasta 45 días). Las métricas se guardan en `metricas`, en ese orden;
    `metrica` es la principal (la primera). Los coachings anteriores tienen su única métrica.
  - La hora la pone el servidor. La fecha puede ser de este mes (o de los últimos 2 días);
    con más de 48 h de atraso cuenta igual, pero queda **fuera de término**. Se corrige o se
    anula (si fue un error) durante 24 h; después solo se agregan el seguimiento y
    aclaraciones. Nada se borra: cada versión queda en `sup_coaching_eventos` y en la
    auditoría. La bitácora (novedades, ausencias, incidencias, reconocimientos) no se edita.
  - **Impacto medido** (`supervision/impacto.py`, cuentas puras), antes contra después:
    conversación de 5 días con conexión de cada lado (Productividad); Pospago y GPON en
    netas por hora conectada, solo con netas maduras (se activan hasta 7 días después de la
    venta); uso de líneas, % sin uso de las Pospago vendidas después contra las de antes
    **con la misma antigüedad** (de 3 a 21 días de activadas: las de antes salen de la foto
    que se guarda al registrar). Resultado: mejoró, igual o empeoró según una banda de
    tolerancia, o sin datos. Con varias métricas se mide **cada una por separado** y el
    resultado del coaching las combina: mejoró o empeoró si las que tienen datos van para el
    mismo lado (o quedan igual), **mixto** si unas mejoran y otras empeoran. Al registrar el
    seguimiento se guarda la medición; si algo no mejoró, el portal propone un coaching nuevo
    sobre **las métricas que no mejoraron** (queda encadenado). El foco cuenta un coaching si
    «uso de líneas» es una de sus métricas.
  - **Seguimientos próximos:** «Para hoy» avisa los seguimientos de los próximos 2 días hábiles
    (con sábados a medio día y feriados) y la tarjeta de seguimientos marca cada uno con
    «Hoy», «Último día», «Mañana» o «En N días» (en azul los próximos). A los jefes, el
    centro de comandos les avisa los seguimientos vencidos y el registro filtra los próximos
    7 días.
  - **Registro por rango** (`GET …/supervision/registro` para los jefes, `GET …/portal/registro`
    para el supervisor, que ve solo lo suyo): indicadores (coachings, seguimientos a tiempo,
    próximos, mejora medida), por métrica, por supervisor y por asesor, y la lista con los
    textos (hasta 1.500; los indicadores cuentan todos). Para que un año entero responda
    rápido, los indicadores leen solo las columnas que necesitan y los textos se piden solo
    para lo que se lista.
  - **Alertas de uso con fecha** (`supervision/alertas.py`): al leer el mes en curso se
    abren las alertas nuevas (el día en que se generó el informe de Ventas Netas que las
    mostró) y se cierran las que ya no están; con esa fecha se mide el foco.
- **Tickets de revisión** (`supervision/tickets.py`, `sla.py`, `tickets_api.py`; tablas
  `sup_tickets`, `sup_ticket_eventos`):
  - Los envían quienes tienen la utilidad `tickets` (coordinador, sub gerente, controller,
    auditor y el superadmin): tipo (venta observada, línea sin uso, calidad de atención,
    reclamo, conducta u otro), prioridad, asesor, referencia y descripción. Si nombra a un
    asesor, llega al supervisor que lo tenía el día del caso; si no, se elige el supervisor.
  - Plazos en horas hábiles del horario de atención (por defecto de lunes a viernes de 7 a
    19 y el sábado de 8 a 12; un día hábil = la jornada completa): alta 2 h para la primera
    respuesta y 1 día para resolver; media 8 h y 2 días; baja 1 día y 5 días. Se guardan al
    enviar el ticket.
  - Primera respuesta: lo primero que hace el supervisor (responder, pedir datos o
    resolver). La resolución corre mientras el ticket está nuevo o en gestión: se detiene
    mientras espera datos de quien lo envió (sin respuesta en 2 días hábiles se cierra
    solo) y sigue desde donde estaba si se reabre (hasta 5 días hábiles después de
    resuelto; la reapertura queda contada). Al 75% del plazo pasa a «por vencer».
  - Métricas: cumplimiento (respondidos y resueltos en plazo; los vencidos cuentan como
    fuera de plazo, los cancelados y los cerrados sin datos no cuentan), velocidad en
    mediana y percentil 90, reaperturas y antigüedad de la bandeja. Los avisos de
    vencimiento se ven en la aplicación (bandeja de los jefes y «Para hoy» del portal).
- **Centro de comandos** (`supervision/comando.py`, `comando_api.py`; tabla `sup_alertas_comando`):
  - **Semáforo:** «atención» si tiene un ticket o un seguimiento vencido, una alerta de uso sin
    coaching a tiempo, una proyección bajo el 90% del objetivo (no provisoria) o 3 días hábiles
    o más sin registrar gestión (coachings, seguimientos, notas o respuestas a tickets, desde que
    se mide la gestión o desde que recibió el equipo); «revisar» si está en crítico, en riesgo o
    con plazos por vencer; «al día» si no. Ordenado: primero quien necesita atención.
  - **Alertas del día:** supervisor en crítico, asesor que cruza el umbral de sin uso,
    proyección bajo el 90%, ticket o seguimiento vencido, supervisor sin registrar gestión,
    asesores sin supervisor y nombres sin vincular. Se ponen al día al abrir el centro: se
    abren cuando aparece la condición (con la fecha en que empezó) y se cierran solas cuando
    deja de cumplirse; si vuelve con el mismo inicio, se reabre la misma. Cada una guarda
    quién la tomó y qué hizo, el ticket que se pidió desde ahí («pedir revisión»: llega al
    supervisor de la alerta, con el asesor si es de uno) o el motivo del descarte. Actúan
    quienes gestionan Supervisión (`supervision_gestion`: coordinador, sub gerente y
    controller); pedir una revisión pide además la utilidad `tickets`. Auditor y analista lo
    ven en lectura. Cada acción queda auditada y en la línea de tiempo del supervisor.
- **Seguridad:** el portal filtra en el servidor por el usuario (solo sus asesores, en
  las fechas en que los tuvo, y solo sus coachings, notas y tickets); ver las líneas sin uso de un
  asesor y cada registro de coaching quedan auditados. Los jefes ven el coaching de cada
  supervisor sin poder cambiarlo.
- **Permisos:** `supervision` (ver, también los tickets), `supervision_gestion` (equipos,
  objetivos, calendario), `tickets` (enviar y seguir tickets), `operadores` (vínculos),
  `supervision_parametros` (pesos del scoring, solo sub gerente) y `portal_supervisor`
  (solo el perfil Supervisor).

## Televentas CLARO · Informe diario

El seguimiento diario de la operación. Lo preparan el **coordinador**, el **sub gerente** y el
**superadmin** (utilidad `informe_diario`; a otro perfil, como el controller, se le puede asignar en
Perfiles). Código en `backend/app/operativas/televentas_claro/informe_diario/`.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Preparar informe diario | Botón en el inicio de Televentas CLARO, en el centro de comandos y en Mis informes | Abre el borrador del día (o el que ya existe): uno por persona y fecha, de hoy o de hasta 7 días atrás |
| Mis informes | `/televentas-claro/informe-diario` | El de hoy, los últimos 14 días (firmado, borrador o sin informe), los compromisos abiertos y los comentarios nuevos del superadmin |
| Informe | `…/informe-diario/{id}` | El editor mientras es borrador; después, la lectura con **Descargar PDF** y **Compartir** (en el celular, a WhatsApp o al correo) y los comentarios |
| Seguimiento (superadmin) | `…/informe-diario/seguimiento` | Cumplimiento por autor y día, informes sin revisar, alertas por palabras clave, compromisos abiertos y vencidos, y el diccionario |

- **Contenido**, en este orden (también en el PDF):
  1. **Resultados del día** (zona manual): Pospago y GPON, obligatorios (pueden ser 0), y **otros** que se
     agregan con +; cada uno con meta opcional (calcula el % de cumplimiento), comentario y el valor del día
     anterior. Si la planilla de netas más nueva tiene las cargas del día, se ofrecen con un clic («Usar estos
     valores») y quedan anotadas como fuente.
  2. **Datos de la plataforma**: se importan datos ya cargados: Productividad de llamadas del día (agentes,
     horas, % de conversación, llamadas, contacto, AHT, pausas, agentes en rojo, alertas y turnos), las ventas
     del día de la planilla de netas, los objetivos y la proyección del mes por supervisor, y el coaching del
     día. Los calcula el servidor (con `fuentes.py`, como el SPH y Supervisión) y quedan **congelados** en el
     informe; «Actualizar» los vuelve a traer. Cada fuente exige el permiso de su módulo; Facturación no se ofrece.
  3. **Resumen del día**.
  4. **Métricas críticas** (con +): nombre, indicador, estado (crítica, atención o en orden), comentario y
     **compromiso o anotación**, con responsable y fecha. «Traer las del informe anterior» copia las métricas
     del último informe, con su valor como «antes».
  5. **Figuras**: gráficos, indicadores, tablas o tableros del **lienzo de Voi, el agente**, que el autor suma al
     informe (con **Armar con Voi**, desde la tarjeta que Voi propone en el chat o directo desde el lienzo; ver [Modo
     informe diario](#modo-informe-diario-armar-el-informe-con-voi)), y **capturas o fotos que sube el autor**
     («Subir imagen», arrastrar o soltar; PNG, JPG, WebP o GIF de hasta 15 MB), como la evidencia del informe de
     auditoría. Cada figura queda numerada, con título y lectura editables; un gráfico guarda su especificación
     congelada (en la pantalla se vuelve a dibujar igual aunque los datos cambien) y el navegador lo captura como
     imagen para el PDF («Imagen lista para el PDF»; indicadores, tablas y tableros van con sus datos); una imagen se
     procesa sin metadatos y su huella entra en el código de verificación. Hasta **20** por informe; se quitan con un
     toque. Mientras Voi está en modo informe diario con ese informe, la sección lo dice («Voi, el agente, está en modo
     informe diario con este informe») y se actualiza sola.
  6. **Seguimiento de compromisos**: los compromisos abiertos de informes anteriores; en cada informe se marcan
     cumplido, en curso o no cumplido, con una nota. Cumplido y no cumplido los cierran.
  7. **Firma**: nombre y cargo (editable; se recuerda) y, si se quiere, la **firma manuscrita** dibujada con el
     dedo o el mouse (PNG validado con Pillow, hasta 120 KB; se guarda para los próximos informes).
- **Guardado automático** del borrador (a 1,2 s del último cambio), con aviso si se intenta salir sin guardar. Manda
  **solo lo que cambió** (el `PUT` es parcial: lo que no viene queda como está), así no pisa lo que Voi acaba de
  escribir en el mismo informe.
- **Se actualiza sola cuando Voi cambia el informe**: cada acción de Voi sobre un informe diario (preparar el borrador,
  cargar resultados, importar datos, sumar figuras, comentar) avisa a la pantalla (`voi:informe`); el editor trae el
  informe del servidor y aplica solo lo que cambió, sin perder lo que el usuario está escribiendo, con el aviso «Voi
  actualizó el resumen y los datos de la plataforma»; la vista de un informe firmado también se refresca.
- **Firmar**: hacen falta Pospago, GPON y el resumen (20 caracteres o más). El informe queda cerrado con un
  **código de verificación** (SHA-256 del contenido, el nombre, el cargo, la hora y la firma): si alguien lo
  modificara en la base, el código deja de coincidir y el superadmin lo ve. Después solo se agregan comentarios.
- **PDF** (`reportlab`, A4, con el logo y las tipografías de la marca, Manrope y Barlow Condensed, licencia
  OFL, en `backend/app/assets/fonts`): encabezado, resultados con su cumplimiento y el día anterior, datos
  importados, resumen, métricas críticas, **figuras** (la imagen subida o la captura del gráfico; si no la hay, sus
  datos en una tabla), seguimiento de compromisos y la firma con el código. Un borrador sale
  con la marca de agua «BORRADOR». El texto del usuario se escapa y lo que la tipografía no puede dibujar
  (emojis) se quita.
- **Palabras clave** (`palabras.py`, explicable y sin servicios externos): normaliza el texto (minúsculas, sin
  tildes) sin mover las posiciones, busca las frases y palabras de cada tema con su plural y las raíces con
  `*`, y no cuenta las negadas («no hubo reclamos»; la negación no cruza comas ni puntos, ni sale de una frase
  ya encontrada como «sin uso»). Los temas críticos (riesgo y urgencia) dan la alerta del informe: alta con 3
  o más menciones, media con 1 o 2. El superadmin ve las palabras resaltadas en cada informe, los temas y las
  palabras más mencionadas del período, las menciones por día y las alertas, y **edita el diccionario**
  (temas, palabras y cuáles son críticos; se puede restablecer).
- **Seguimiento del superadmin**: se espera un informe firmado por día hábil (de lunes a viernes, sin feriados
  ni no laborables del calendario de Supervisión) desde el día en que se instaló el módulo; el sábado cuenta si
  hay informe. Muestra el cumplimiento por autor y día, quién firmó después de su día, los informes sin
  revisar, las alertas y los compromisos abiertos y vencidos. El superadmin comenta cada informe (queda
  revisado) y el autor responde; los comentarios nuevos le aparecen al autor en su lista.
- **Seguridad**: cada informe lo ven su autor y el superadmin; solo el autor edita su borrador (también sus
  figuras, y solo mientras es borrador: al firmar entran en el código de verificación); el seguimiento
  y el diccionario son del superadmin. Preparar, importar, firmar, descargar el PDF, comentar, revisar, quitar una
  figura y cambiar el diccionario o la firma quedan en la auditoría. Las capturas de las figuras se procesan en un
  subproceso aislado (WebP sin metadatos) y viven en el disco persistente (`UPLOAD_DIR/informe_diario/<id>/`); se
  borran con el borrador.
- Tablas: `informes_diarios` (con la columna JSON `figuras`), `informes_diarios_compromisos`,
  `informes_diarios_comentarios`, `informes_diarios_firmas` e `informes_diarios_parametros`. Migraciones de datos: la
  utilidad para el coordinador y el sub gerente, y el día desde el que se mide el seguimiento.

## Televentas CLARO · Auditoría de Ventas

Circuito de trabajo del área de Auditoría de Ventas sobre los informes de
Ventas Netas. Código en `backend/app/operativas/televentas_claro/auditoria/`.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Informes de auditoría | `/televentas-claro/auditoria` | Lista por estado con hallazgos abiertos y de severidad alta |
| Riesgos | `…/riesgos` | Elegir fuentes (un informe de Ventas Netas por mes) y ver el análisis en vivo; crear el informe |
| Informe | `…/informes/{id}` | Resumen, hallazgos, **evidencia visual**, gráficos, seguimiento, redacción y vista para imprimir en PDF |
| Guía del auditor | `…/guia` | Esquemas de riesgo, Sali Hablando, líneas sin uso, patrones de venta y entrega, semáforo del vendedor, alertas de negocio, checklist y recomendaciones tipo; imprimible en PDF |

- Al crear un informe (`AUD-AAAA-NNN`) se **congela** una copia de los datos
  analizados (`snapshot`): aunque después se eliminen los informes de origen,
  la auditoría conserva todo. `snapshot.py` consolida las fuentes: ranking de
  vendedores con nivel (crítico / atención / normal), puntaje y señales, datos
  llamativos, series para gráficos, líneas sin uso y Sali Hablando como
  evidencia, y los **hallazgos automáticos** (uno por vendedor riesgoso más
  los generales: Sali Hablando, riesgo alto sin uso, finalizadas sin activar,
  pendientes viejas, suspendidas).
- Estados: **Borrador → En revisión → Cerrado → Archivado** (se puede reabrir).
  En Borrador y En revisión se edita todo; Cerrado fija la redacción, los
  gráficos y los hallazgos pero sigue el seguimiento (estado, responsable,
  notas); Archivado es solo lectura. Un borrador lo elimina su autor o el superadmin.
- Fuentes: informes de Ventas Netas publicados y borradores (los reemplazados
  no), uno por mes. Si una fuente fue generada por una versión anterior del
  análisis, la auditoría la **recalcula sola** desde los datos guardados al
  analizarla (queda en el registro como `reprocess_ventas_netas_report`, origen
  `auditoria`); si no se puede, se usa como está y el snapshot lo advierte.
- El PDF sale de la pestaña Informe (portada, datos, alcance, resumen,
  indicadores, datos llamativos, hallazgos con su evidencia resumida, gráficos
  elegidos por el auditor, vendedores riesgosos, conclusiones, recomendaciones
  y bitácora). Las líneas de evidencia de cada hallazgo van en un **anexo
  opcional** (casilla en la pestaña), porque multiplican las páginas.
- Reglas del análisis: `snapshot.py` concentra en constantes con nombre los
  umbrales, las condiciones de nivel del vendedor, los pesos del puntaje, los
  patrones de concentración y las reglas de los datos llamativos.
  `GET /auditoria/parametros` las expone y la **Guía del auditor** las muestra,
  así que la guía siempre dice lo que el sistema aplica; además, cada snapshot
  guarda las reglas con las que se evaluó. Los ejemplos de la guía usan cifras
  agregadas del corte de septiembre 2026 (sin vendedores ni líneas), y no incluye
  montos de comisión (Facturación es solo superadmin).
- **Crítico** es solo el vendedor con más de 35% de sus líneas Pospago sin uso con
  3+ días de activadas (`UMBRAL_CRITICO_SIN_USO_PCT`, con 5 o más evaluables; las
  en espera no cuentan). Rige igual en Ventas Netas ("Ver críticos") y en
  Auditoría. Todo otro riesgo del vendedor es **alerta media**.
- Informe final en dos versiones, cada una en PDF para enviar: **ejecutivo**
  (resumen del auditor, indicadores, hallazgos generales y críticos, alertas medias
  en una tabla, gráficos con los comentarios del auditor, críticos, conclusiones y
  recomendaciones) y **extenso** (todas las detecciones con su evidencia completa).
- Un informe en Borrador o En revisión hecho con reglas anteriores muestra un aviso
  y se puede **actualizar con el criterio vigente**: se vuelven a congelar los datos
  de las mismas fuentes; los hallazgos automáticos intactos se regeneran y los que
  el auditor trabajó (editados, con estado o notas) y los manuales se conservan.
- Utilidad `auditoria`: Analista por defecto; el superadmin la asigna a
  Coordinador desde Perfiles. Todo queda en el registro de auditoría general.

### Evidencia visual (figuras del informe)

La pestaña **Evidencia** del informe junta las **figuras numeradas** que respaldan la auditoría:

- **Gráficos de Voi**: piezas del lienzo (gráficos, indicadores, tablas o partes de un tablero) que el auditor suma
  desde Voi en **modo auditor** (ver más abajo). Se congela la especificación ya validada: se vuelve a dibujar igual en
  la pantalla y en el PDF, aunque los datos cambien después.
- **Imágenes aportadas** (capturas del CRM, fotos de legajos, otras pruebas): se suben eligiéndolas, **arrastrándolas**
  o **pegándolas con Ctrl+V**, con progreso por archivo. PNG, JPG, WebP o GIF de hasta 15 MB y 60 megapíxeles.
- Cada figura tiene título (la conclusión), **lectura del auditor**, el **hallazgo que respalda** (H-02) y su fuente; se
  ordenan con flechas o arrastrando, se ven en grande en un visor y se quitan con confirmación. Mientras el informe
  está en Borrador o En revisión se editan; cerrado, quedan fijas (se siguen viendo). Cada cambio queda en la
  bitácora del informe (tipo «Evidencia») y en el registro de auditoría general.
- **Elegir archivos sin esperar:** en Chrome y Edge el botón **Subir imágenes** usa la ventana moderna
  (`showOpenFilePicker`), que arranca en el **Escritorio** y recuerda la última carpeta de esta pantalla; la ventana
  clásica de Windows abre en la última carpeta que usó el navegador (a veces Imágenes en OneDrive o una carpeta de red
  con miles de fotos) y tarda minutos en listarla. Donde no existe, queda el selector clásico filtrando por extensión
  (`.png,.jpg,.jpeg,.webp,.gif`), nunca por tipo MIME. Además, **Capturar pantalla** toma una ventana (p. ej. el CRM)
  desde el navegador y la suma como figura sin buscar ningún archivo, y **Ctrl + V** pega una captura del portapapeles.
- **Se guarda solo:** la cabecera del informe muestra «Sin guardar → Guardando… → Guardado hh:mm» (o «No se pudo
  guardar · Reintentar»). La redacción se guarda un segundo después de la última tecla y al salir de la pestaña; los
  gráficos, al cambiarlos; los hallazgos, la evidencia y el seguimiento, al instante. Con algo sin guardar, el
  navegador avisa antes de cerrar la pestaña.
- **En el informe**: el ejecutivo suma la sección **Evidencia visual** con cada figura numerada, su lectura, la fuente
  y el hallazgo; los hallazgos citan sus figuras («Evidencia visual: Figura 2 y 5»). El extenso agrega además un
  **índice de figuras**. Las secciones se numeran solas y el PDF espera a que carguen las imágenes.

**Seguridad de las imágenes.** Se procesan en un **subproceso aislado** (`app/services/imagenes.py`, solo Pillow): se
valida que sean imágenes reales (estructura completa y formato admitido, tope de píxeles contra «bombas» de
descompresión), se enderezan según la cámara, se les quitan **todos los metadatos** (EXIF con ubicación GPS,
dispositivo, fecha; XMP; perfiles) y se vuelven a codificar en **WebP** (completa hasta 2.400 px, sin pérdida para
capturas; miniatura de 720 px). Nunca se guarda el archivo original tal como llegó. Se guardan en el **disco
persistente** (`UPLOAD_DIR/auditoria/<informe>/`, con escritura atómica y rutas que arma el servidor) y se sirven solo
con el permiso de Auditoría (`image/webp`, `nosniff`, caché privada). Si el almacenamiento se pierde, la figura queda
con su ficha y avisa que la imagen no está. Eliminar un borrador borra su carpeta.

| Endpoint (`/api/v1/televentas-claro/auditoria…`) | Qué hace |
|---|---|
| `GET /informes/{id}` | El informe (también acepta el código, `AUD-2026-003`); en la app, `/televentas-claro/auditoria/<id>` redirige a `/televentas-claro/auditoria/informes/<id>` |
| `GET /informes/{id}/evidencias` | Figuras del informe, en orden |
| `GET /informes/{id}/evidencias/indice` | Índice liviano para Voi: informe, hallazgos y figuras (con la pieza de origen) |
| `POST /informes/{id}/evidencias/imagen` | Subir una imagen (multipart: `archivo`, `titulo`, `nota`, `hallazgo_id`) |
| `GET /informes/{id}/evidencias/{eid}/imagen?v=completa\|miniatura` | La imagen (WebP), con la sesión |
| `PATCH /informes/{id}/evidencias/{eid}` · `DELETE …` | Editar título, lectura y hallazgo (`""` lo desvincula) / quitar |
| `POST /informes/{id}/evidencias/orden` | Nuevo orden (todas las figuras, una vez cada una) |

## Televentas CLARO · Facturación (solo superadmin y Sub gerente)

Liquidación de comisiones de Claro (Telemarketing Fijo PGY), portada desde
*Operaciones Voicenter* (`cobranzasegurossuda`) y mantenida idéntica a ese repo en lógica y pantallas.
Voicenter vende líneas pospago móvil (y GPON) para Claro Paraguay (entidad 300383) y cobra por liquidación
mensual. Esta sección documenta las pantallas, **cómo liquida Claro**, **cómo lo modelan los simuladores**
(mensual, convergente y GPON) y **con qué datos se calibró** el modelo.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Reportes | `/televentas-claro/facturacion` | Liquidaciones cargadas, publicar y eliminar |
| Subir liquidación | `…/upload` | Sube el `.txt` (cp1252, `;`) a la cola de procesamiento |
| Reporte | `…/reports/{id}` | Conceptos, drivers, ventas, **Gross y netas (criterio Claro)**, suspensiones PFI, documentación, mix de planes |
| Comparar | `…/compare` | Matriz por concepto, Gross y netas por mes y descomposición del cambio entre meses |
| Simulador | `…/simulador` | Una cohorte de ventas: facturación del mes, retención a 6 y 12 meses, margen |
| Simulador convergente | `…/simulador-anual` | Proyección a 12 o 18 meses multicohorte de pospago **+ GPON vendido por la misma estructura**, IDEAL, Gross, zafra contra el Ideal, bono único, Optimizar, registro de simulaciones |
| GPON | `…/gpon` | El simulador anual con el motor y las variables del negocio fibra, con estructura propia |
| Criterios | `…/criterios` | Reglas de liquidación sobre un escenario fijo |
| Agente IA | `…/agente` | Analista de facturación sobre los reportes (requiere `OPENAI_API_KEY`) |

Todo el código vive en `backend/app/operativas/televentas_claro/facturacion/`.

- **Procesamiento:** el endpoint solo guarda el archivo (y una copia comprimida en la base, `contenido_gz`);
  un worker supervisado reclama cada carga y la parsea en un **subproceso aislado** con timeout, para
  que un archivo malo no pueda tumbar la API (`jobs/queue.py`).
- **Lógica:** parser en `parser.py`; análisis, comparativo y simuladores en
  `analyzers/` (`analisis`, `compare`, `simulador`, `gpon`, `convergente`). Los simuladores tienen tests
  calibrados con liquidaciones reales.
- **API:** `/api/v1/televentas-claro/facturacion/*` y
  `/api/v1/televentas-claro/facturacion-agent/*`, todo con `require_perm("televentas_claro.facturacion")`.
- **Sincronización con `cobranzasegurossuda`:** los analizadores, el parser, los schemas, los tests y los
  componentes del frontend son los mismos archivos; acá solo cambian las rutas de import, el prefijo de la API,
  los `href` y el control de acceso por utilidad. Al traer un cambio de ese repo, aplicar esas mismas reglas.

### 1. Cómo liquida Claro

Fuentes: el detalle de liquidación (archivo `.txt` con una fila por línea y concepto) y el *Manual de esquemas y
conceptos de liquidación* de Claro (canal telemarketing, marzo 2021), cuya lógica de conceptos es la misma que
aparece en las liquidaciones móviles.

**Reglas generales**

- Las gestiones de un mes se liquidan **al mes siguiente**. La liquidación cierra alrededor del día 15.
- **Chargeback**: 180 días desde la activación. Dentro de esa ventana Claro descuenta lo que pagó por la línea si la
  línea cae; fuera de ella ya no descuenta (las filas "fuera de chargeback" existen pero salen en 0).
- Cada línea tiene su propia historia de conceptos, identificada por `NroCelularGestion` y `Cabecera`.

**Conceptos de la liquidación (nombre exacto), regla y momento**

| Concepto | Regla (manual + lo observado en 7 liquidaciones) | Cuándo |
|---|---|---|
| ACTIVACIONES · cuota 1 (*upfront*) | Comisión por instalación: 204.545 (CG15G), 245.455 (CG30G), 272.727 (CG50B / C100X), 436.364 (C200X). | Mes de la venta |
| ACTIVACIONES · cuota 2 (*diferido*) | 34.091 / 81.818 / 109.091 / 136.364 / 181.818 por plan. Se paga si la línea está activa al día 90 y el legajo está completo; incompleto cobra 50%, no presentado cobra 0. Sale en 0 para las líneas caídas. | ~100 días (mes 3) |
| ACTIVACION PORTABILIDAD NUMERICA (plus porta) | 218.182 / 245.455 / 327.273 / 409.091 / 545.455 por plan, en las activaciones con portación (90% de las ventas). | Mes de la venta |
| INCENTIVO PRODUCTIVIDAD (1771) | Por línea en estado A (la observación de cada fila informa "Obj CO / %Cumpl."); monto por escala de cumplimiento del objetivo CO. Escala vigente comunicada por Claro: ≥110% 120.000 · ≥105% 115.000 · ≥100% 105.000 · ≥95% 40.000 · <95% 0. Historial liquidado: 2025 pagó 95.000 al ≥100%; ene a may 2026 pagó 110.000 al ≥100% y 50.000 entre 95 y 100%. Objetivos informados: 1.950 (nov-25), 1.750 (dic-25), 1.900 (ene a may-26). | Mes de la venta |
| RECALCULO INCENTIVO PRODUCTIVIDAD (1871) | Descuenta el bono de las líneas que no llegaron activas al día 180 (las suspendidas sin cancelar cuentan como activas). | Mes 6 |
| INCENTIVO EFECTIVIDAD DISTRIBUCION (1891) | 50.000 / 45.000 / 35.000 por venta según efectividad de entregas (≥85 / ≥82 / ≥80%). Se paga en una parte de las activaciones (87,5%). | Mes de la venta |
| DESCUENTO INCENTIVOS POR PENALIDAD | Devuelve el bono efectividad de la línea que cae dentro del chargeback. | Con la caída |
| RESIDUAL | 14,5% del **monto acreditado** (lo que el cliente pagó), durante 12 liquidaciones. Las líneas que no pagan salen con "LINEA INACTIVA" en 0. | Meses 1 a 12 |
| SUSPENSIONES | "Suspensión penalizable, primera factura impaga" (**PFI**, razón P9-735, 96% de las suspensiones): descuenta cuota 1 + un residual (214.431 en CG15G). Las suspensiones estándar salen en 0. PFI real por mes de venta (8 liquidaciones 2026): ene 26,9% · feb 28,5% · mar 28,7% · abr 35,3% · may 37,6% → 31,4% de las ventas en cohortes maduras; el 16% se reconecta. En el modelo vive dentro de la zafra (caída del mes 1 al mes 2). | ~60 días (p10 57 · p90 83) |
| RECONEXIONES | Devuelve lo descontado por suspensiones y cancelaciones si la línea se reconecta dentro del chargeback. | ~130 días |
| DESCUENTO PORTABILIDAD NUMERICA | Devuelve el plus porta de la línea que cae dentro del chargeback (falta de pago, port out, primera factura impaga). | Con la caída |
| REVERSO DESCUENTO PORTABILIDAD NUMERICA | Devuelve el descuento anterior si la línea se reconecta. | ~140 días |
| PENALIZACION POR DEUDA | Presuspensión ≥45 días o cancelación por falta de pago: descuenta cuota 1 (montos parciales, ~158.000 a 247.000). | ~140 días |
| REVERSO PENALIZACION POR DEUDA | Reverso de la anterior al reconectar. | — |
| REVERSO ACTIVACION / RECUPERO ACTIVACION | Cancelación temprana (reverso de activación, falta de tráfico): descuenta la cuota 1 completa; el recupero la devuelve. | ~20 días |
| PENALIZACIÓN POR MIGRACIÓN DE NEGOCIO | La línea migra a otro negocio (prepago): pierde la cuota 1 (~207.000). | ~90 días |
| LINEA CON DOCUMENTACION FALTANTE | A los 26 días sin legajo: 100% de cuota 1 y 2; incompleto u observado: 50%; rechazado: 100%. | ~40 días |
| AJUSTE LEGAJO / DEVOLUCION DESCUENTO DOCUMENTACION ACTIVACION | Ajuste del anterior; devolución al día 365 si la línea sigue activa (menos del 1% de la facturación). | Mes 12 |
| CANCELACIONES / CONCEPTO INICIO DE PRESUSPENSION / CAMBIO DE PLAN | Cancelación estándar (0), inicio de presuspensión (0), diferencia de comisión por cambio de plan (mínimo). | — |

### 2. Las siete liquidaciones analizadas

Detalle completo, fila por fila (255.748 filas), de las liquidaciones 383 a 389. Cada una cubre las gestiones del mes
indicado y los ajustes de todas las cohortes anteriores. Importes en millones de guaraníes.

| Liq. | Mes de gestión | Filas | Activaciones cuota 1 | Créditos | Débitos | **Neto liquidado** |
|---|---|---|---|---|---|---|
| 383 | 2025-11 | 34.814 | 1.992 | 1.366,5 M | -396,0 M | **970,4 M** |
| 384 | 2025-12 | 34.033 | 1.764 | 1.243,5 M | -419,7 M | **823,8 M** |
| 385 | 2026-01 | 36.608 | 1.918 | 1.323,0 M | -540,5 M | **782,5 M** |
| 386 | 2026-02 | 36.313 | 1.825 | 1.207,8 M | -435,6 M | **772,2 M** |
| 387 | 2026-03 | 37.681 | 1.928 | 1.391,2 M | -584,3 M | **806,9 M** |
| 388 | 2026-04 | 37.489 | 1.913 | 1.450,1 M | -545,7 M | **904,4 M** |
| 389 | 2026-05 | 38.810 | 1.832 | 1.329,2 M | -728,6 M | **600,6 M** |
| **Total** | 7 meses | 255.748 | 13.172 | 9.311,3 M | -3.650,4 M | **5.660,8 M** |

Por concepto (millones de Gs; "Recuperos" = reconexiones + reversos de descuentos + recupero de incentivos y de
activación + devolución de documentación):

| Liq. | Cuota 1 + 2 | Plus porta | Bono prod. | Bono efect. | Residual | Desc. porta | Suspensiones | Recálculo bono | Desc. incent. | Deuda | Legajos | Reverso act. | Migración | Recuperos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 383 | 496,2 | 394,9 | 188,3 | 82,1 | 134,0 | -170,7 | -90,3 | 0,0 | -35,6 | -33,2 | -41,9 | -8,8 | -14,0 | 70,9 |
| 384 | 431,5 | 375,3 | 166,8 | 76,5 | 138,7 | -180,1 | -115,6 | 0,0 | -40,1 | -33,8 | -18,8 | -13,9 | -15,5 | 54,7 |
| 385 | 486,6 | 388,9 | 210,3 | 82,8 | 140,3 | -222,4 | -121,2 | -55,5 | -39,1 | -36,5 | -19,3 | -27,8 | -14,7 | 14,1 |
| 386 | 469,6 | 398,3 | 91,0 | 79,1 | 138,6 | -190,9 | -68,9 | -59,5 | -31,6 | -32,0 | -17,9 | -19,7 | -11,7 | 31,1 |
| 387 | 484,1 | 433,2 | 211,2 | 88,0 | 138,0 | -221,3 | -175,8 | -36,6 | -51,7 | -36,9 | -20,1 | -27,4 | -11,5 | 36,7 |
| 388 | 509,6 | 458,7 | 210,1 | 86,9 | 141,7 | -212,5 | -98,3 | -97,0 | -36,7 | -41,0 | -27,0 | -20,3 | -9,0 | 43,1 |
| 389 | 481,3 | 429,3 | 91,4 | 80,8 | 141,0 | -218,2 | -183,8 | -98,7 | -53,5 | -30,5 | -111,0 | -18,1 | -11,2 | 105,3 |
| **Total** | **3.358,9** | **2.878,6** | **1.169,1** | **576,2** | **972,3** | **-1.416,1** | **-853,9** | **-347,3** | **-288,3** | **-243,9** | **-256,0** | **-136,0** | **-87,6** | **355,9** |

Lecturas del cuadro: la cuota 1 y el plus porta son dos tercios de los créditos; el descuento de portabilidad es el
débito más grande y supera a las suspensiones; los legajos de mayo (111 M) son un pico aislado, el resto está entre
18 y 42 M. Bono productividad por mes según "Obj CO / %Cumpl." de la liquidación:

| Liq. | Objetivo CO | Cumplimiento | Bono por línea |
|---|---|---|---|
| 383 (nov-25) | 1.950 | 101,6% | 95.000 |
| 384 (dic-25) | 1.750 | 100,3% | 95.000 |
| 385 (ene-26) | 1.900 | 100,6% | 110.000 |
| 386 (feb-26) | 1.900 | 95,8% | 50.000 |
| 387 (mar-26) | 1.900 | 101,1% | 110.000 |
| 388 (abr-26) | 1.900 | 100,5% | 110.000 |
| 389 (may-26) | 1.900 | 96,2% | 50.000 |

Si no se llega al objetivo se paga el escalón alcanzado y nada por debajo del 95%. Con la escala vigente: entre
95% y 100% son 40.000 por línea; al 100% 105.000; al 105% 115.000; al 110% 120.000. Las líneas en estado C o S
("no suma y no paga") quedan fuera: entre 3 y 10 por mes.

**Indicadores medidos por liquidación** (base de la calibración):

| Liq. | Porta | Bono efect. cobrado | Cuota 2 cobran | Suspensiones | Deuda | Reverso | Migración | Legajos / activación | Recupero |
|---|---|---|---|---|---|---|---|---|---|
| 383 | 88% | 82% | 57% | 24% | 8,5% | 2,1% | 3,5% | 20.355 | 21,0% |
| 384 | 82% | 87% | 52% | 31% | 9,5% | 3,7% | 4,3% | 9.926 | 14,4% |
| 385 | 89% | 86% | 56% | 28% | 9,4% | 7,0% | 3,6% | 9.401 | 3,0% |
| 386 | 90% | 87% | 52% | 17% | 8,5% | 4,9% | 3,2% | 9.195 | 9,2% |
| 387 | 93% | 91% | 49% | 41% | 8,8% | 6,4% | 2,8% | 7.687 | 6,5% |
| 388 | 92% | 91% | 53% | 23% | 9,4% | 4,8% | 2,2% | 11.636 | 9,9% |
| 389 | 94% | 88% | 52% | 45% | 7,4% | 4,4% | 2,7% | 59.422 | 21,2% |
| **Ponderado** | **89,8%** | **87,5%** | **53,0%** | **29,7%** | **8,8%** | **4,8%** | **3,2%** | **11.500 (sin mayo)** | **12,1%** |

Porcentajes sobre las activaciones cuota 1 del mes; "Recupero" = devuelto ÷ descontado (ver §4).

Curva real de **líneas que pagan residual** por mes de antigüedad (146.000 filas RESIDUAL), contra la **zafra**
oficial de líneas activas:

| Mes | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pagan residual | 91,3 | 63,7 | 53,8 | 51,7 | 50,9 | 49,5 | 46,6 | 43,7 | 42,4 | 39,6 | 35,7 | 32,4 |
| Zafra (activas) | 82,6 | 58,5 | 53,8 | 53,1 | 49,2 | 51,1 | 46,2 | 41,9 | 40,7 | 40,1 | 40,4 | 41,8 |

### 3. El modelo del simulador

Motor: `backend/app/operativas/televentas_claro/facturacion/analyzers/simulador.py`. Todos los parámetros están en `PARAMETROS_DEFAULT`
y son editables desde "Variables de negocio"; las simulaciones guardadas conservan los suyos.

**Entrada**: ventas efectivas del mes (= activaciones cuota 1; la efectividad de entregas no descuenta ventas, solo
elige el escalón del bono efectividad). Tarifas y abono se ponderan por el mix de planes.

**Mes 0 (facturación del mes)**

```
activaciones  = ventas × cuota1_ponderada × (1 + ajuste_comisiones)
portabilidad  = ventas × porta_pct × porta_plus_ponderado × (1 + ajuste_comisiones)
bono_prod     = ventas × pct_estado_a × monto_escala(cumplimiento = ventas × pct_estado_a ÷ objetivo_co)
bono_efect    = ventas × pct_bono_efectividad_cobrado × monto_escala(efectividad)
bono_adicional = monto cargado a mano (no se devuelve ni se recalcula)
```

**Meses 1 a 12 de cada cohorte** (`z[k]` = zafra a la edad k, `rc[k]` = curva de líneas que pagan residual)

```
residual_k     = ventas × z[k−1] × cobrabilidad[k] × 14,5% × abono_acreditado × abono_ponderado   (k = 1..12)
                 el residual del mes k lo generan las líneas activas al cierre del mes k−1 que pagaron su factura;
                 cobrabilidad[k] = curva real de líneas que cobran residual ÷ zafra real del mes anterior, tope 100 %
                 (el residual SIGUE a la zafra; con residual_segun_zafra = False se usa la curva fija residual_curva_pct)
legajos_1      = − ventas × (no_presentado × cuota1 + incompleto × cuota1 ÷ 2)         (k = 1)
caidas_k       = ventas × (z[k−1] − z[k])                                             (k ≤ chargeback)
devolucion_k   = − caidas_k × [ pen × (cuota1 + residual_por_linea) + porta_pct × porta_plus ] × (1 − recupero)
dev_bono_k     = − caidas_k × pct_bono_efectividad_cobrado × bono_efect_por_venta × (1 − recupero)
migracion_3    = − ventas × migracion_pct × cuota1                                     (k = 3, sin recupero)
cuota2_3       = ventas × z[3] × cuota2_ponderada × (1 − incompleto ÷ 2 − no_presentado)
recalculo_6    = − ventas × pct_estado_a × bono_prod_por_linea × pct_recalculo
                 pct_recalculo = 100 − zafra[6] (regla de Claro: 100% del bono de TODAS las líneas caídas al día 180;
                 48,9% con la zafra tipo). Se puede fijar a mano un % distinto.
                 Bono efectividad (concepto 471): se devuelve completo (50.000) en cada caída dentro de los 180 días,
                 sobre todo en los meses 1 y 2 (PFI); en 6 meses devuelve el 46–47% de las líneas que lo cobraron y
                 se re-acredita (472) en ~8–11% de las devoluciones al reconectar. Nada después del día 180.
```

**Caídas que devuelven la cuota 1 (`pen`, 85%)**, explicado en llano. La zafra dice cuántas líneas caen (con la
zafra tipo, 49 de cada 100 en 6 meses). Pero no toda caída devuelve lo mismo:

- Claro descuenta la **cuota 1** (más un residual) solo cuando la línea se suspende por falta de pago (PFI o deuda) o
  se reversa la activación. Si el cliente se va por port out o se cancela fuera del chargeback, la cuota 1 no se
  descuenta. En las liquidaciones reales, de cada 100 ventas 46 devolvieron la cuota 1 (29,7 suspensión + 8,8 deuda +
  4,8 reverso + 3,2 migración) contra 51 caídas de la zafra → 46 ÷ 51 ≈ **85% de las caídas**.
- El **plus porta** y el **bono efectividad** se descuentan en el **100%** de las caídas del chargeback.

Con 1.950 ventas: caen 955 líneas en 6 meses → 812 devuelven cuota 1 + residual, 860 (las portadas) devuelven el plus
porta y 836 (las que lo cobraron) devuelven el bono efectividad; al total se le resta el recupero por reconexión (12%).
El panel "Chargeback y recuperos" del simulador muestra esta cuenta con los valores cargados. Ponerlo en 100%
supone que toda caída pierde la cuota 1, algo que Claro no hace. El ajuste de comisiones negociado con Claro escala
cuota 1, cuota 2 y porta (también sus devoluciones) y no toca bonos, residual ni la remuneración del vendedor.

**Salidas de la cohorte**: facturación bruta; "queda a 6 meses" (ya cayeron todas las caídas, residual a medias:
la cifra que decide); "queda a 12 meses" (residual completo); peso de los bonos sobre la facturación; cierre
(devoluciones y cobros a 12 meses, gana o pierde).

**Simulación anual (12 o 18 meses)**: el mes 1 fija la estructura y el objetivo; cada mes es una cohorte. El mes
calendario *t* liquida su propio mes 0 más los flujos de todas las cohortes anteriores en la edad que les toca.
Nombres de mes editables, bono adicional por mes, y **meses afectados** (un mes puede tener porta, efectividad,
objetivo, mix, ajuste, bonos, legajos, caídas, recupero o costos variables propios). Al cierre queda la **cola**:
lo que las últimas cohortes todavía tienen por cobrar (residual, cuota 2) y por devolver (caídas). Todo redondea
por flujo y deriva lo demás de los redondeados, así cada puente cierra exacto: bruta + ajustes = neto;
neto − costos = resultado; acumulado anterior + resultado = acumulado; resultado + cola = resultado final.

**Valores iniciales y escenario IDEAL (móvil)**: el simulador anual abre con los valores iniciales definidos por la
dirección (`frontend/src/components/facturacion/presets.ts`): 1.700 ventas y objetivo CO 1.700, efectividad 85%,
bono efectividad cobrado 87,5%, estado A 100%, porta 90%, y estructura de 17 ventas por vendedor, 1 supervisor cada 14,
1 backoffice cada 180 ventas, 1 coordinador, 2 controllers, operador 14.635 × 7 h × 23 días, comisión 95.000 y plus
12.500 por venta. La zafra inicial es la real. El botón **IDEAL** aplica todo eso más la **zafra ideal**
(99,9 · 82,6 · 75 · 70 · 67 · 63 · 60 · 58 · 56 · 54 · 53 · 51 · 49); en la zafra hay también un enlace "Zafra ideal"
para cambiar solo la curva. **Restaurar valores reales** vuelve a los parámetros calibrados del backend
(`PARAMETROS_DEFAULT`), que no cambian.

**Gross y netas con el criterio de Claro (en el simulador anual, debajo de las ventas por mes)**: los tres gráficos
de Claro ("Ventas Móv", "Netas Móv", "%Gross/Vta") con los números de la simulación. Por mes calendario *t*:

```
bajas_gross_t = Σ_cohortes ventas_c × pct_bajas_gross × max(0, z[edad−2] − z[edad−1])    (edad = t − c, 2 ≤ edad ≤ chargeback+1)
netas_gross_t = ventas_t − bajas_gross_t          pct_gross_t = bajas_gross_t ÷ ventas_t
```

Las bajas de la cohorte a la edad *k* son las caídas de la zafra a la edad *k−1* (Claro cancela ~30 días después de
suspender) por `pct_bajas_gross` (60%: de cada 100 caídas de la zafra, las que Claro registra como baja por su razón,
sin port out; real 2026 por cohorte 60–75%). Antes del mes 1 se asume régimen (cohortes previas iguales al mes 1), así
el mes 1 no muestra cero bajas. Con la zafra real y ventas estables el %Gross queda en ~30% (los meses estables de Claro
dan 28–32%); con la zafra ideal, ~24%. Banda de referencia en el gráfico: **22–27%** (otros calls 12–27%); `anual`
informa `pct_gross`, `pct_gross_max`, `pct_gross_max_mes` y `meses_gross_sobre_banda`. Un mes de ventas bajas dispara el
% aunque la venta no haya empeorado, porque las bajas vienen de los meses anteriores (agosto 2026).

**Descuentos de Claro sobre los bonos (escenario de negociación)**: dos interruptores debajo del escenario de bonos,
"No aplicar descuento sobre bono productividad" (`devolver_bono_productividad: false` → sin RECALCULO INCENTIVO
PRODUCTIVIDAD 1871 al mes 6) y "No aplicar descuento sobre bono logística" (`devolver_bono_efectividad: false` → sin
DESCUENTO INCENTIVOS POR PENALIDAD 471 del bono efectividad/distribución en las caídas). Los bonos se cobran igual en
el mes; lo que deja de devolverse pasa íntegro al resultado. Con uno activo, el simulador corre en paralelo la misma
simulación con los descuentos y muestra la devolución evitada, el resultado, el margen y el resultado con cola de los
dos casos. Viajan en `parametros`, así que se guardan con la simulación (el registro marca "sin desc. productividad /
logística").

**Propuesta 2027 en el simulador (móvil)**: en la barra "Escenario de bonos", el botón **Bono único propuesto** carga
en `escala_productividad` la escala ≥110% 55.000 · ≥100% 50.000 · ≥95% 35.000 · ≥90% 25.000 (debajo de 90%: 0), deja el
bono efectividad en 0 (queda dentro del único), apaga los dos descuentos y marca `bono_unico: true`; el mismo botón
vuelve a los bonos vigentes. La escala se edita en "Bono productividad" de las variables. En la barra "Ajuste de
comisiones", el botón **Optimizar** carga +40% sobre cuota 1, cuota 2 y porta (`AJUSTE_OPTIMIZAR_PCT` en presets.ts),
editable antes de simular, y aparece la tarifa resultante por plan. Ambos viajan en `parametros` y se guardan con la
simulación (el registro marca "bono único" y "comisiones +N%"). Con la zafra real y estructura real, bono único + 40%
da en régimen +6,5% de margen a 1.900 ventas, +2,3% a 1.700 y +0,7% a 1.600: positivo en todos los niveles, sin acantilado.

**Evolución de la zafra contra el Ideal** (debajo del Gross): la zafra cargada (% de líneas activas por mes de
antigüedad, M0 a M12) sobre la banda de la zafra Ideal **±3,5 puntos** (la marca), con la zafra real de las
liquidaciones punteada como referencia y el M2 marcado como PFI. Los meses por debajo de la banda se pintan en rojo
(más caídas que lo admitido) y los que están por encima en verde; cuatro tarjetas muestran activas al M2, M3, M6 y M12
en % y en líneas, con la diferencia en puntos contra el Ideal. Tolerancia en `ZAFRA_TOLERANCIA` (SimuladorAnual.tsx)
y zafra Ideal en `presets.ts`.

**La ola de la zafra (riesgo potencial por bajar productividad)**: cada cohorte deja comprometidas devoluciones
para los meses siguientes. Por mes calendario el motor informa `ola_devoluciones` (legajos + caídas + devolución de
bonos + recálculo heredados), `ola_cobros` (residual + cuota 2 heredados) y `ventas_equilibrio`: las ventas mínimas
del mes para que bruta(v) + ajustes heredados − costos(v) ≥ 0 con la estructura fija (bisección). Con ventas
estables la ola crece hasta estabilizarse; si las ventas bajan, la ola sigue pegando sobre menos facturación y el
mes queda `en_riesgo`. Se muestra como área roja en los gráficos del simulador anual y como hito en la historia.

**Costos de la estructura (por mes)**

```
vendedores    = ventas ÷ ventas_por_vendedor (1 supervisor cada 14; 1 backoffice cada 180 ventas; 1 coordinador; 2 controllers; SubGerencia opcional)
salario operador = 14.635 Gs/h × 7 h × 23 días
comisión vendedor = ventas × 102.000 Gs   → dentro del RRHH: paga IPS y aguinaldo
plus vendedor     = ventas × 32.000 Gs    → fuera del RRHH: sin IPS ni aguinaldo
IPS        = 16,5% × todo el RRHH (salarios, comisiones, supervisores, coordinación, backoffice, controllers, subgerencia)
aguinaldo  = RRHH ÷ 12 por mes (sin IPS)
logística  = ventas × (60% × 80.000 Interior + 40% × 55.000 Central) + 20.000.000 de cobertura adicional interior (fijo mensual)
operativos = ventas × 12.500
```

El peso de comisión + plus sobre la facturación se muestra solo como referencia. Margen = lo que queda de la
facturación (mes 0, 6 y 12 meses) − costo de la estructura; punto de equilibrio a 6 meses por bisección.

### 4. Calibración (valores por defecto)

| Parámetro | Default | Base |
|---|---|---|
| Mix de planes | CG15G 58% · CG30G 39% · CG50B 2,5% · C100X 0,5% | Activaciones cuota 1 de las 7 liquidaciones |
| Portabilidad | 90% | 82–94% por liquidación, ponderado 89,8% |
| Efectividad de entregas | 89% | Real 88,5–89,1% |
| Activaciones que cobran bono efectividad | 87,5% | 82–91% por liquidación |
| Líneas en estado A | 99,5% | Bono productividad pagado en todas las activaciones salvo 3 a 10 líneas en estado C/S por mes |
| Escala del bono productividad | ≥110% 120.000 · ≥105% 115.000 · ≥100% 105.000 · ≥95% 40.000 · <95% 0 | Escala vigente comunicada por Claro (ene–may 2026 liquidó 110.000 / 50.000) |
| Legajo incompleto / no presentado | 5% (50%) / 3% (100%) | 11.500 Gs por activación sin el pico de mayo |
| Cuota 2 | mes 3, zafra al día 90 | 53% cobra, 27.491 Gs por activación (modelo 26.400) |
| Residual | 14,5% × 48% del abono, 12 meses; líneas que pagan en el mes k = activas al cierre del mes k−1 × cobrabilidad (real: 91 · 77 · 92 · 96 · 96 · 100 · 91 · 95 · 100 · 97 · 89 · 80 %) | 78.400 Gs por activación en 12 meses con la zafra real; sube si la zafra mejora |
| Zafra | 99,9 · 82,6 · 58,5 · 53,8 · 53,1 · 49,2 · 51,1 · 46,2 · 41,9 · 40,7 · 40,1 · 40,4 · 41,8 | Cohortes jul-25 a ene-26 informadas por Claro |
| Chargeback | 6 meses | Manual (180 días); descuento de porta 100% dentro de la ventana |
| Caídas que devuelven la cuota 1 | 85% de las caídas | 46% de las activaciones (susp. 29,7 + deuda 8,8 + reverso 4,8 + migración 3,2) contra 51% de caídas de la zafra; el resto de las caídas devuelve solo porta y bono |
| PFI real por mes de venta (8 liq. 2026) | vive en la zafra (M1 → M2) | ene 26,9% · feb 28,5% · mar 28,7% · abr 35,3% · may 37,6% (31,4% ponderado en cohortes maduras); jun 30,4% con 2 liquidaciones. Suspensión a los 60 días (p10 57, p90 83) |
| Migración de negocio | 3,2% en el mes 3 | 2,2–4,3% por liquidación, ~207.000 por línea |
| Recálculo del bono productividad | 100% del bono de las líneas caídas al día 180 = 100 − zafra[6] (48,9%), mes 6 | Concepto 1871, una fila por línea de la cohorte, entre el día 152 y 184: líneas castigadas jul-25 41%, ago 45%, sep 52%, oct 51%, nov 52% (promedio 48,5%). Ningún descuento de bonos después del día 184 (cohortes observadas hasta 12 meses) |
| Recupero por reconexión | 12% | Ver definición abajo |
| Caídas que terminan en baja (Gross Claro) | 60% de las caídas de la zafra | Bajas por razón de Claro sin port out ÷ caídas de la zafra a 6 meses: 29–38% contra 48,9% por cohorte 2026 |
| Comisión / plus del vendedor | 102.000 / 32.000 Gs por venta | Promedio real pagado |

**Recupero por reconexión** = devuelto ÷ descontado, ponderado sobre las 7 liquidaciones (21,0 · 14,4 · 3,0 · 9,2 ·
6,5 · 9,9 · 21,2% → 12,1%). Devuelto: RECONEXIONES + REVERSO DESCUENTO PORTABILIDAD NUMERICA + RECUPERO INCENTIVOS
REVERSO PENALIDAD + REVERSO PENALIZACION POR DEUDA + RECUPERO ACTIVACION. Descontado: SUSPENSIONES + DESCUENTO
PORTABILIDAD NUMERICA + DESCUENTO INCENTIVOS POR PENALIDAD + PENALIZACION POR DEUDA. Cada liquidación por separado
salta porque los reversos corresponden a descuentos de meses anteriores; el valor de conjunto es el que vale.

**Qué fila del EERR alimenta cada concepto**: Activaciones (cuota 1) ← ACTIVACIONES cuota 1 · Plus portabilidad ←
ACTIVACION PORTABILIDAD NUMERICA · Bono productividad ← INCENTIVO PRODUCTIVIDAD · Bono efectividad ← INCENTIVO
EFECTIVIDAD DISTRIBUCION · Residual ← RESIDUAL · Cuota 2 ← ACTIVACIONES cuota 2 · Legajos ← LINEA CON DOCUMENTACION
FALTANTE + AJUSTE LEGAJO · Devoluciones por caídas ← SUSPENSIONES + DESCUENTO PORTABILIDAD NUMERICA + PENALIZACION
POR DEUDA + REVERSO ACTIVACION + CANCELACIONES + PENALIZACIÓN POR MIGRACIÓN DE NEGOCIO, netas del recupero ·
Devolución bono efectividad ← DESCUENTO INCENTIVOS POR PENALIDAD · Recálculo ← RECALCULO INCENTIVO PRODUCTIVIDAD.
No modelados: CAMBIO DE PLAN, CONCEPTO INICIO DE PRESUSPENSION POR DEUDA y la devolución de documentación al día 365.

### 4b. Negocio GPON (fibra) — modelo propio

Página **Facturación → GPON** (`/televentas-claro/facturacion/gpon`): es el MISMO simulador anual de pospago (setear mes 1, ventas por mes, nombres de meses, meses afectados, bono a mano, registro de simulaciones con marcas, post-its y notas, historia animada, cierre, EERR, bonos mes a mes) con el motor y las variables GPON; las simulaciones guardadas quedan separadas por negocio. Motor `analyzers/gpon.py`, endpoints
`GET /televentas-claro/facturacion/gpon/parametros`, `POST /televentas-claro/facturacion/gpon/simulador` (una cohorte) y
`POST /televentas-claro/facturacion/gpon/anual` (12 / 18 / 24 meses). Calibrado fila por fila con las seis liquidaciones GPON
385–390 (entidad 300383, ene–jun 2026: 9.455 filas, 1.361 activaciones de las que **1.193 son fibra (IF) y 168 IPTV**).

**GPON = fibra. IPTV no cuenta como GPON** y no se simula: son ~14 líneas por cada 100 GPON (124 de 168 en la misma
cuenta que una fibra), cuota 1 de 120.000 (TVP) o 25.000 (TVA), sin bono, y dejan ~3,6 % del neto GPON (23 M de 634 M
en el semestre).

| Liq. | Mes | Activ. IF | IPTV | Bono IF por línea | Cumplimiento (Obj IF 200) |
|---|---|---|---|---|---|
| 385 | ene-26 | 218 | 21 | 100.000 | 109 % |
| 386 | feb-26 | 181 | 23 | 0 | 82 % (obj. 220) |
| 387 | mar-26 | 215 | 23 | 100.000 | 107,5 % |
| 388 | abr-26 | 195 | 36 | 50.000 | 97,5 % |
| 389 | may-26 | 166 | 22 | 0 | 83 % |
| 390 | jun-26 | 218 | 43 | 100.000 | 109 % |

| Concepto | Regla calibrada (solo fibra) |
|---|---|
| Cuota 1 | Al activar, por plan: Fibra 60 (IF60 / BAF7 / BAFE7) 400.000 · Fibra 30/40 (IF30 / IF40 / BAF3) 325.000. Mezcla real 74 / 26 % → 380.000 por línea. |
| Cuota 2 | Día 62–86 (mediana 73 → liquidación del mes 2): 280.000 / 200.000. La cobra el 96 % de las líneas con legajo presentado (0 = "línea inactiva al día 60"), el 92 % completa y el resto a la mitad por legajo incompleto. |
| Bono fijo (1771) | Solo líneas IF en estado A, en el **100 %** de ellas cuando el mes llega al objetivo de líneas IF (Claro usa 200). Escala vigente ≥110 % 130.000 · ≥105 % 125.000 · ≥100 % 120.000 · ≥95 % 40.000; en 2026 liquidó con la anterior: 100.000 (≥100 %), 50.000 (95–100 %), 0 (82–83 %). |
| Recálculo (1871) | Día 155–179: el 100 % del bono de las líneas caídas, 23–26 % de las cohortes que cobraron bono. |
| Legajos | Día 30–55 desde la venta, dos casos: **LEGAJO NO PRESENTADO** descuenta el **100 % de la cuota 1**, la línea no cobra cuota 2 (0) y no genera mora, sin devolución posterior (real ene–abr 2,8 % de las líneas IF; feb 6,6 %); **LEGAJO INCOMPLETO U OBSERVADO** descuenta el 50 % y la cuota 2 se cobra a la mitad (real 7,7 %; enero 21 %). Parámetros `legajo_no_presentado_pct` (3 %) y `legajo_pct` (8 %). |
| Mora | PENALIZACION POR DEUDA (P7, al suspender por deuda; tabla: Fibra 60 630.000, Fibra 30 475.000, con cuotas parciales) y REVERSO PENALIZACION (R7, cuando el cliente paga). Solo pesa la **neta**: el 55–60 % de las líneas se penaliza alguna vez y el 28 % queda con deuda a los 6 meses (enero 27 % a 5 meses, febrero 24 %, marzo 18 % a 3 meses), ~520.000 / 430.000 por línea en mora. Primera penalización p10 día 55, p25 68, mediana 101, p75 143, p90 161 → curva acumulada 0 / 3 / 22 / 52 / 78 / 95 / 100 %. |
| Chargeback | 180 días; después del mes 6 no hay débitos. **Sin residual, sin portabilidad, sin bono efectividad.** Otros reversos (MALAVF mala venta) 0,5 %. |
| Costos | Comisión y plus del asesor, **recupero de documentación 55.000 por venta GPON** (sin cargas), operativos. Página GPON sola: estructura propia dimensionada con las activaciones; convergente: sin estructura (la de pospago). |

Unidad económica real por línea IF (cohorte ene-26 a 5 meses, sin el recálculo todavía): cuota 1 393.000 + cuota 2
221.000 + bono 100.000 − legajos 52.000 − mora neta 140.000 − otros 5.000 = **517.000 (1,31 × cuota 1)**; marzo a 3
meses 642.000. El modelo con el bono de 100.000 da 553.000 a 5 meses (enero tuvo el doble de legajos que el promedio)
y, con la escala vigente, 536.000 de por vida (1,41 × cuota 1): cuota 1 380.500 + cuota 2 231.400 + bono 120.000 −
legajos 24.700 − mora 139.000 − recálculo 30.000. La anualidad es idéntica en lógica a pospago: cada mes es una
cohorte, el mes N suma su facturación más los ajustes de todas las anteriores, la estructura se fija en el mes 1, y al
cierre queda la cola (cuota 2 por cobrar, mora y recálculo por devolver).

### 4c. Simulador convergente (pospago + GPON por la misma estructura)

El simulador anual de pospago (`/televentas-claro/facturacion/simulador-anual`) es ahora el **Simulador Convergente**: el 100% del
staff es convergente, cada asesor vende pospago y GPON. Motor en `analyzers/convergente.py`, endpoint
`POST /api/v1/televentas-claro/facturacion/convergente/anual` (`GET …/convergente/parametros` devuelve las variables de los dos negocios).

- **Una sola estructura.** La dotación se dimensiona con las ventas de pospago del mes 1 (ventas por vendedor,
  supervisores, backoffice, coordinación, controllers) y queda fija, igual que antes. GPON **no agrega personas**: sus
  costos son solo comisión y plus por venta GPON (con el IPS y aguinaldo de pospago), recupero de documentación
  (55.000 por venta), operativos y logística GPON
  (`costos_gpon_compartidos`, headcount GPON = 0 en `_costos_y_margen`).
- **Ventas GPON = vendedores × GPON por asesor**, editable por mes (ideal 3). El objetivo del bono fijo GPON se setea
  solo en vendedores × 3 (desmarcable en pantalla; en el motor, si `gpon.parametros.objetivo` no viene, se usa ese
  ideal). GPON se puede excluir del balance con "Incluir GPON".
- **GPON entra con su modelo de facturación completo** (`simular_gpon_anual`): cuota 1 y bono fijo en el mes de la
  venta; cuota 2 al mes 2, legajos, mora neta con su curva (26% de líneas a 6 meses: 0 · 3 · 22 · 52 · 78 · 95 · 100%),
  recálculo del bono al mes 6 y otros reversos de las cohortes anteriores; cola posterior y líneas en mora.
- **Pospago corre igual que antes**; el resultado mensual de GPON (ingreso neto − costos variables) se le pasa como
  `aporte_externo_por_mes` a `simular_anual`, que lo usa solo para las ventas mínimas del mes y los meses en riesgo:
  la estructura fija se cubre con los dos negocios juntos.
- **El balance es la suma**: por mes `facturacion_bruta`, `ajustes`, `ingreso_neto`, `costo_total`, `resultado`,
  `acumulado`, ola de devoluciones y cobros; cada fila conserva el desglose (`ingreso_neto_movil/gpon`,
  `resultado_movil/gpon`, `gpon_cuota2`, `gpon_mora`, `gpon_recalculo`, `gpon_costos`…). `anual` suma los dos
  negocios (cola, veredicto, régimen, mejor/peor mes) y expone `ventas_gpon`, `aporte_gpon_ingreso_pct` y los totales
  de cada negocio; `movil` y `gpon` traen sus `anual` y conclusiones propias.
- **Pantalla**: panel "Convergente · GPON" en el mes 1 (GPON por asesor, variables GPON con costos variables únicamente),
  bloque "GPON por asesor" por mes en el paso 2, KPIs GPON, EERR con secciones POSPAGO / GPON / COSTOS GPON, tabla
  "Bono fijo GPON mes a mes" y línea de activaciones GPON en el gráfico de ventas. Gross, zafra, bono único, descuentos
  y ajuste de comisiones siguen siendo de pospago (GPON tiene su propio ajuste en sus variables).
- **Meses afectados GPON**: el ✎ de un mes (en la grilla de ventas o en el bloque "GPON por asesor") abre el mismo
  editor con los grupos de pospago y los grupos **GPON ·** (`CAMPOS_AFECTABLES_CONVERGENTE`): legajos no presentados
  (100 % de la cuota 1, sin cuota 2 ni mora), legajos incompletos, objetivo, mora, recálculo, costos variables GPON.
  Las variaciones GPON se guardan en `meses_afectados[mes].gpon` y `separarAfectados` las reparte entre los dos
  motores. `legajo_no_presentado_pct` arranca en 0 % y se carga por mes.
- **Registro**: la configuración GPON viaja en `parametros.convergente` (el motor de pospago la ignora) y se guarda con
  la simulación; las simulaciones anteriores se abren como pospago puro.
- Tests: `backend/tests/test_facturacion_convergente.py` (misma dotación, costos GPON solo variables, suma exacta de los
  dos negocios con mora/cuota 2/recálculo, GPON apagado = pospago, equilibrio con aporte GPON, por asesor variable).

### 5. Herramientas del módulo

- **Simulador mensual** (`/televentas-claro/facturacion/simulador`): una cohorte; EERR a mes 0 / 6 / 12 meses, estructura
  necesaria, remuneración del vendedor, peso de los bonos, cierre con veredicto, explicación de cada cuadro.
- **Simulador convergente** (`/televentas-claro/facturacion/simulador-anual`, antes "simulador anual"): pospago + GPON por la misma estructura (ver 4c); 12 o 18 meses con cohortes superpuestas, EERR mes a mes,
  meses afectados, bono adicional por mes, gráficos, historia animada del negocio con hitos y alertas, y **registro
  del trabajo** (simulaciones guardadas con nombre y comentario, notas tipificadas, ítems marcados y post-its
  arrastrables), en una barra lateral ocultable. Todo se imprime como informe.
- **Reportes de liquidación** (`/televentas-claro/facturacion`): carga del `.txt`, resumen por concepto, comparación entre
  liquidaciones con descomposición del delta, y **Gross y netas con el criterio de Claro** (abajo).
- **Gross y netas (criterio Claro)**. Los gráficos de Claro "Ventas Móv", "Netas Móv", "Desc Gross" y "%Gross/Vta"
  se replican desde la liquidación así: *Ventas* = activaciones cuota 1 del mes (coincide con Claro a ±10 líneas);
  *Desc Gross* = líneas dadas de baja **en el mes** (concepto CANCELACIONES, una vez por línea), de **cualquier cohorte**,
  por razón de Claro (PFI P9-735, falta de pago P7, contratación dudosa P9-722, usurpación P9-787…), **sin los port
  out** (PNPOUT); *Netas* = ventas − Desc Gross; *%Gross/Vta* = Desc Gross ÷ ventas. No es una métrica de la cohorte
  del mes: ~85% de las bajas son ventas de 1 a 3 meses antes (el PFI pega a los 60 días), así que mide caja del mes y
  en un mes de ventas bajas el % salta aunque la venta no haya empeorado (agosto 2026: 62% en Claro con 1.410 ventas).
  Replicación 2026 (liquidación vs gráfico de Claro): ene 28% vs 32 · feb 31 vs 32 · mar 27 vs 29 · abr 27 vs 28 ·
  may 30 vs 30 · jun 33 vs 35 · jul 36 vs 45 · ago 53 vs 62. La diferencia de julio y agosto es que la liquidación
  solo lista cancelaciones de líneas de hasta 6 meses; las bajas de líneas más viejas (cohortes de enero a junio
  cumpliendo 7 a 12 meses) están en el reporte de base de Claro y no en la liquidación. La calidad de la venta del mes
  se mide por cohorte (PFI por mes de venta, "Cohorte x Liquidación"). Se muestra en cada reporte (`data.gross`:
  activaciones, desc_gross, pfi, port_out, netas, pct_gross, por_razon, por_edad, por_cohorte) y en el comparativo
  (`gross` con las series por mes). Los reportes procesados antes de esta métrica hay que volver a subirlos.
- Endpoints: `GET /api/v1/televentas-claro/facturacion/simulador/parametros`, `POST /api/v1/televentas-claro/facturacion/simulador`,
  `POST /api/v1/televentas-claro/facturacion/simulador/anual`, CRUD en `/api/v1/televentas-claro/facturacion/simulaciones`.
- Tests: `backend/tests/test_facturacion_simulador.py` (invariantes del motor, aditividad al guaraní, calibración),
  `test_facturacion_simulaciones.py` (registro del trabajo) y `test_facturacion_gross.py` (Desc Gross / netas).

### 6. Voi maneja el simulador

Voi (el agente de la plataforma) es experto en este negocio y maneja el simulador convergente de punta a punta, con el
mismo motor y los mismos valores iniciales que la pantalla. Solo para quien tiene Facturación (superadmin y Sub gerente);
la habilidad `voi-facturacion` lleva el modelo del negocio y, en `referencia/modelo-de-liquidacion.md`, esta misma
documentación completa.

| Herramienta | Qué hace |
|---|---|
| `facturacion_simular_anual` | Corre el simulador convergente (12 o 18 meses): ventas por mes, `preset` (`inicial` = valores iniciales de la dirección con la zafra real; `ideal` = botón IDEAL; `real` = calibrados), `bono_unico` y `optimizar` (propuesta 2027), `cambios` de cualquier parámetro (incluidas zafra, escalas de bonos, mix de planes y costos), `meses_afectados` (pospago y GPON), `gpon` (por asesor, objetivo, variables). Con `escenarios` (2 a 4) devuelve la comparación con las diferencias contra la base. |
| `facturacion_simulaciones_guardadas` · `facturacion_simulacion_guardada` | El registro del trabajo: lista y detalle (qué difiere de lo calibrado, zafra, GPON, notas); `recalcular: true` la vuelve a correr. |
| `facturacion_guardar_simulacion` | Acción propia (nivel 2, auditada con origen `voi`): guarda el escenario con nombre, comentario, notas y la foto del resultado, exactamente como el botón «Guardar simulación». Devuelve `/televentas-claro/facturacion/simulador-anual?abrir=<id>`, que `abrir_pantalla` usa para abrirla en la pantalla con sus gráficos y el registro al lado. |
| `facturacion_anotar_simulacion` | Suma notas (supuesto, observación, decisión, pendiente, riesgo; opcionalmente de un mes) o cambia el comentario de una simulación guardada. |

Los presets de la pantalla (`frontend/src/components/facturacion/presets.ts`) tienen su espejo en
`backend/app/operativas/televentas_claro/facturacion/analyzers/presets.py`: si cambia uno, cambia el otro. Tests:
`backend/tests/test_asistente_facturacion_simulador.py`.

### 7. Impresión del simulador

«Imprimir / Guardar PDF» arma un informe con portada, un **encabezado corrido** en cada hoja (simulador, nombre de la
simulación, horizonte y fecha) y, antes de los resultados, la **ficha de la simulación**: todos los datos con los que se
simuló (ventas por mes y GPON por asesor, la zafra cargada contra la ideal y la real, las tarifas de Claro por plan con
cuota 1 upfront, cuota 2, plus porta y abono, bonos y reglas de liquidación, chargeback y recupero, residual, costos de la
estructura, GPON, meses afectados y notas). Lo que difiere de los valores calibrados con las liquidaciones reales va
marcado con ✱. Las secciones interactivas no se imprimen; resultados y EERR arrancan en hoja nueva. Componente
`FichaSimulacion.tsx`; estilos en `globals.css` (`.ficha-impresa`, `.print-shell`, `.sim-print`).

## Televentas CLARO · Logística de entregas

El corte de pedidos de logística (.xlsx, una fila por pedido) se convierte en el informe del mes. Utilidades
`televentas_claro.logistica` (ver) y `logistica_gestion` (subir, publicar, reemplazar, recalcular, eliminar); por
defecto el sub gerente y el controller tienen las dos, el analista las dos, el coordinador y el auditor solo ver.
Código en `backend/app/operativas/televentas_claro/logistica/` y pantallas en `/televentas-claro/logistica`.

- **Archivo** (`parser.py`): columnas Nro. Formulario, LINEA_ORIG, Nro. Documento Cliente, Nombre Completa, Ciudad
  Cliente, Departamento, REGION, Fecha Venta, Ven_Nombre Completo, Promoción, ESTADO y MOTIVO. Los encabezados se
  reconocen sin tildes ni mayúsculas y con alias; la fila de encabezados se busca entre las primeras 20. Estado
  canónico ENTREGADO · EN GESTION · DEVUELTO (otros se conservan y se avisan); sin motivo, se toma el estado.
- **Subir** (`POST /uploads`, multipart `file` + `fecha_corte` opcional, por defecto hoy): se lee y analiza en el
  mismo pedido y queda el **borrador** del mes (el mes con más pedidos). Las filas leídas se guardan comprimidas para
  recalcular. La **fecha del corte** es desde donde se mide la demora.
- **Informe** (`analyzer.py`, versionado): KPIs por estado con %, **estado × zona** (región, departamento, ciudad)
  en cantidad y %, **motivos × región** para todos y para cada estado, **línea de tiempo** por fecha de venta (del día
  y acumulado, por estado), **pendientes y demora por zona** (EN GESTION: días desde la venta al corte, promedio,
  máximo y tramos 0-2 · 3-5 · 6-10 · 11+ por región → departamento → ciudad, por motivo y la lista del más demorado
  al más nuevo), vendedores, promociones y el **detalle completo** (todos los pedidos con sus días).
- **Pantalla**: KPIs, **filtro dinámico por estado** (Todos · Entregado · En gestión · Devuelto) que recorta todas las
  secciones, tablas con conmutador cantidad/%, gráfico de línea de tiempo (Recharts), pendientes desplegables por
  zona, vendedores y la data completa con búsqueda, filtro por región y descarga CSV.
- **Publicación**: misma lógica que Ventas Netas: `draft` → `published` (uno por mes; reemplazar pide confirmación y
  el anterior queda `replaced`), `despublicar`, `recalcular`, eliminar (solo no publicados). Quien no gestiona ve solo
  lo publicado. Todo auditado (`logistica_corte_subido`, `_informe_publicado`, `_reemplazado`, `_despublicado`,
  `_recalculado`, `_eliminado`).
- **Voi**: consulta `logistica_del_mes` (entregas, motivos, pendientes y demorados) y guía «Subir el corte de pedidos».
- **Integraciones**: dataset `logistica_pedidos` (un pedido por fila de los cortes publicados).

| Método | Ruta (`/api/v1/televentas-claro/logistica`) | Quién |
|---|---|---|
| POST | `/uploads` | Gestión: sube el corte y devuelve el borrador (`informe`, `avisos`) |
| GET | `/informes` · `/informes/{id}` | Ver (solo publicados) · gestión (todos) |
| POST | `/informes/{id}/publicar` (`confirm_replace`, `title`) · `/despublicar` · `/recalcular` | Gestión |
| DELETE | `/informes/{id}` | Gestión (no publicados) |

Tests: `backend/tests/test_logistica.py` (parser con alias y fechas en texto, análisis contra las tablas del modelo,
API con permisos, publicación única, reemplazo, despublicación, recálculo, eliminación y dataset).

## Televentas CLARO · Integraciones (solo superadmin y Sub gerente)

Claves de API de **solo lectura** para conectar herramientas de análisis (KNIME, Power BI, Python) a los datos ya
publicados o firmados. Utilidad restringida `televentas_claro.integraciones` (`solo_perfiles: ["sub_gerente"]`): el
sub gerente la tiene por defecto; el resto de los perfiles no la puede tener. **Facturación no tiene dataset**: queda
fuera por diseño. Código en `backend/app/operativas/televentas_claro/integraciones/` y pantallas en
`/televentas-claro/integraciones` (Claves de API · Registro de uso · Conectar KNIME).

- **Claves**: `vcop_` + 40 hex (160 bits). Se muestran **una sola vez**; la base guarda el hash SHA-256 y un prefijo
  visible (`vcop_xxxxxxxx…`) para reconocerlas (búsqueda por prefijo, comparación en tiempo constante). Cada clave
  tiene nombre, dueño, **vencimiento** (hasta 730 días), **límites** por minuto (hasta 600) y por día de Asunción
  (hasta 100.000) y, si se quiere, un subconjunto de datasets.
- **Quién hace qué**: el sub gerente crea, ve y **bloquea las suyas**, y ve sus usos. El **superadmin tiene permiso
  total**: ve todas, bloquea, **desbloquea**, cambia límites y **elimina**. Todo queda en la auditoría de la plataforma
  (`integraciones_clave_creada` · `_bloqueada` · `_desbloqueada` · `_limites` · `_eliminada`).
- **Registro de uso** (`integraciones_usos`): cada llamada con clave, atendida o no, con dataset, filas, ms, IP,
  user agent y resultado `ok` · `limite` (429 con `Retry-After`) · `denegada` (bloqueada, vencida, desconocida o sin
  acceso al dataset) · `error`. Los límites se cuentan sobre este registro (valen con más de una instancia). Si se
  elimina la clave, sus usos quedan con el prefijo y el nombre.
- **Datasets** (`GET /integraciones/datasets/{nombre}`): filas planas (sin estructuras anidadas) para JSON to Table o
  CSV. Parámetros `desde` y `hasta` (por defecto 30 días, tope 400), `formato=json|csv` y `borradores=1`. Tope de
  50.000 filas. El JSON trae `filas`, `columnas`, `truncado` e `items`; el CSV va en UTF-8 con BOM y `X-Filas`.
  Catálogo en `GET /integraciones/datasets`:
  `productividad_dias` · `productividad_agentes` · `ventas_netas_informes` · `ventas_netas_vendedores` ·
  `sph_informes` · `sph_agentes` · `informes_diarios` (firmados, sin comentarios ni figuras) ·
  `informes_diarios_metricas`.
- **Autenticación de los datasets**: `Authorization: Bearer vcop_…` (lo que manda el nodo GET Request de KNIME) o
  `X-API-Key`. También sirve la sesión de alguien con la utilidad (botón «Probar con mi sesión» de la guía); esos usos
  no se registran como de clave.
- **Conectar KNIME** (aplicación de escritorio): Credentials Configuration → GET Request (Authentication → Bearer; en
  KNIME < 5.4, header `Authorization`) → JSON Path `$.items[*]` → Ungroup. La pantalla arma la URL de cada dataset,
  el `curl` de prueba y el ejemplo en Python.

| Método | Ruta (`/api/v1/televentas-claro/integraciones`) | Quién |
|---|---|---|
| GET | `/claves` | Sub gerente (las suyas) · superadmin (todas), con el catálogo y los máximos |
| POST | `/claves` | Crear (devuelve `secreto` una sola vez) |
| POST | `/claves/{id}/bloquear` · `/desbloquear` | Dueño o superadmin · solo superadmin |
| PATCH | `/claves/{id}/limites` · DELETE `/claves/{id}` | Solo superadmin |
| GET | `/claves/{id}/usos` · `/usos?dias=7` | Registro por clave · global (el sub gerente, el de las suyas) |
| GET | `/datasets` · `/datasets/{nombre}` | Clave de API o sesión con la utilidad |

Tests: `backend/tests/test_integraciones.py` (restricción de la utilidad, clave una sola vez, datasets JSON y CSV,
borradores, límites 429, registro, bloqueo, desbloqueo, límites, vencimiento, eliminación y auditoría).

## Voi · el agente de la plataforma (Claude Managed Agents)

**Voi · Powered by Claude** es el agente de IA de la plataforma, en un panel lateral disponible en todas las pantallas
(botón **AI VOI** en la cabecera o **Ctrl/⌘ + K**). **Guía por toda la plataforma**: abre las pantallas por el usuario,
lo lleva paso a paso (con una guía flotante que marca dónde tocar) y le ofrece opciones con botones para elegir o
aprobar con un toque. Consulta y explica los datos de los módulos que el usuario ya ve, los muestra en un **lienzo**
(gráficos, tablas y tableros), responde con lo que dicen los **documentos** que sube el superadmin (con citas), prepara
borradores y propone acciones que el usuario aprueba. Corre sobre **Claude Managed Agents** (Anthropic) con el modelo
**Claude Sonnet 5.5**: Anthropic aloja el bucle del agente y su contenedor; la plataforma le da las herramientas, los
permisos, la memoria y los topes.

### Quién lo usa

| Perfil | Voi | Alcance |
|---|---|---|
| Superadmin | Siempre | Toda la plataforma (incluida Facturación) |
| Sub gerente | Por defecto (utilidad «Asistente IA») | Los módulos de su perfil, incluida **Facturación** |
| Coordinador | Por defecto | Los módulos de su perfil |
| Auditor | Por defecto | **Modo auditoría**: auditoría de ventas (preparar informes y hallazgos, **modo auditor** con evidencia del lienzo), vendedores en alerta, alertas del centro de comandos y tickets |
| Controller, Analista, Cliente | Se les puede asignar | Los módulos de su perfil |
| Supervisor | No (solo entra a su portal) | — |

Voi **nunca ve más que el usuario**: cada herramienta corre con la identidad y los permisos de quien conversa,
**releídos en cada uso** (si el superadmin saca un permiso, deja de valer al instante), y por dentro llama a los mismos
servicios que las pantallas (por ejemplo, quien no tiene Gestión solo ve informes publicados). Los perfiles que ya
existían recibieron la utilidad con la migración de datos `2026-10-asistente-permisos`.

### Cómo está armado

```
Navegador ─► panel de Voi (SSE) ─► FastAPI /api/v1/asistente ─► Claude Managed Agents (Anthropic)
   + lienzo                        ├ consumidor por sesión       agente «Voi» (versionado) + entorno sin internet
                                   ├ ejecuta las herramientas    habilidades (Agent Skills) + memoria por usuario
                                   ├ base de conocimiento (búsqueda y citas)
                                   └ guarda eventos, acciones, piezas del lienzo y consumo en PostgreSQL
```

- **Definición en archivos** (`backend/app/asistente/claude/`): `agents/voi.md` (modelo, instrucciones y herramientas
  del espacio de trabajo), `environments/voi.yaml` (contenedor **sin acceso a internet**) y `skills/*/SKILL.md` (9
  habilidades: ayuda de la plataforma, productividad y SPH, ventas netas, supervisión y alertas, informe diario,
  auditoría de ventas, análisis de datos, **visualización** y **facturación**). Se publican **solas al arrancar** si
  cambiaron (por huella) o desde la consola. Cada cambio del agente es una **versión nueva**; las conversaciones en
  curso siguen con la suya. Si se cambia la clave por la de otra cuenta, o algo se borra en la consola de Anthropic, se
  vuelve a crear solo.
- **Una conversación = una sesión** de Managed Agents, creada con el agente publicado y, solo para ese usuario, las
  herramientas de su perfil, las habilidades de sus módulos, su memoria, el **razonamiento** elegido en la consola y un
  **tope de gasto** que aplica Anthropic.
- **Herramientas de la plataforma** (`herramientas/`): son *custom tools*; la sesión se pausa, el backend las ejecuta y
  le devuelve el resultado. Tres niveles de autonomía:
  1. **Consultar** (corre sola): estado de los datos, productividad del día y por rango, ventas del día y del mes, SPH,
     objetivos y proyección, centro de comandos, tickets, coaching, buscar personas, informes diarios (propios) y, para
     el superadmin, el **seguimiento de los informes de todo el equipo**, auditorías, **buscar en los documentos**,
     **mostrar en el lienzo**, las de guía (**abrir una pantalla**, **guiar paso a paso** y **ofrecer opciones** con
     botones) y, solo con Facturación, **liquidaciones, comparativos, calidad por fecha, criterios, el simulador**
     Pospago/GPON y **el simulador convergente** (escenarios, comparaciones, simulaciones guardadas).
  2. **Lo propio** (corre sola y queda registrada; el superadmin puede pedir confirmación): preparar el **borrador** del
     informe diario con datos importados y el **seguimiento de sus compromisos**; preparar un **informe de auditoría**
     en borrador (con los cortes de Ventas Netas de los meses pedidos) y **agregarle hallazgos**; **guardar y anotar
     simulaciones** de Facturación en el registro del trabajo. Voi nunca firma ni cierra.
  3. **Afecta a otros** (tarjeta con **Aprobar / Cancelar**): enviar un ticket de revisión y darle **seguimiento**
     (comentar, reabrir, cancelar, reasignar); tomar, descartar o derivar una alerta del centro de comandos; **comentar
     un informe diario** (el superadmin, que además lo deja revisado).
  Todo lo que Voi hace queda en la auditoría general (`asistente_accion`, «vía Voi»).
- **Una sola vez:** cada pedido del agente queda en `asistente_acciones`. Si se corta la conexión o se reinicia el
  servidor, al volver se completa lo que quedó sin responder; una acción de nivel 3 cortada a mitad nunca se repite
  sola (se avisa para revisarla). Un doble clic o dos pestañas no confirman dos veces. Si el usuario sigue escribiendo
  sin confirmar, la acción pendiente se cancela.
- **En vivo:** `consumidor.py` escucha el stream de la sesión (con vista previa del texto), repasa la lista de eventos
  para no perder nada, guarda cada evento una sola vez y lo reparte al navegador por SSE. El panel se reconecta solo.
- **Rapidez (menos vueltas por turno):** cada llamada a una herramienta o a un archivo es una vuelta completa al
  modelo (segundos para el usuario). Para acortarlas: el **esfuerzo de razonamiento** arranca en *Rápido* (`low`; el
  superadmin lo sube en la consola); la **memoria del usuario va dentro del contexto del primer mensaje** (el agente
  no la lee con archivos); las instrucciones le piden **no leer habilidades** para una consulta directa de datos; los
  botones **«Armar un tablero · Ver un gráfico · Ver en la pantalla»** que siguen a una consulta los pone **la
  plataforma al terminar el turno** (`plataforma.opciones`, sin llamada del agente); y si en modo auditor o informe
  diario el agente muestra algo en el lienzo y se olvida de ofrecerlo como figura, **la plataforma crea la tarjeta
  igual** (`plataforma.custom_tool_use`, que no se responde a la sesión). Cada paso del chat muestra cuánto tardó la
  herramienta («Consultando la productividad del día · 0,8 s») y el log del servidor lo registra (`Voi · … · ms`).
- **La sesión nunca queda trabada:** Managed Agents no acepta un mensaje nuevo mientras una herramienta sigue sin
  respuesta. Si una herramienta falla o el consumidor se corta antes de responderla, antes de mandar el próximo mensaje
  la plataforma **completa lo que quedó sin responder** (y, si la API igual reclama un evento, se lo contesta y
  reintenta una vez); una acción que todavía corre devuelve 409 («esperá unos segundos») en vez de un 502.
- **Contexto:** cada mensaje lleva quién es el usuario, la fecha y la pantalla en la que está, con qué es esa pantalla
  según el catálogo (el chip de la pantalla se puede apagar).

### El lienzo

Cuando una imagen explica mejor que un párrafo (un ranking, una evolución, una composición, varios indicadores o más
de 8 filas), Voi usa **mostrar_en_lienzo** y la pieza aparece en el **lienzo**: en pantallas anchas se abre solo al lado
del chat; en el celular queda una tarjeta **«Ver en el lienzo»** que lo abre a pantalla completa. También se abre con el
botón del panel (con la cantidad de piezas) o `/lienzo`.

- Formas: indicadores, barras (ranking), columnas, líneas, área, apiladas, dona (hasta 6 partes) y tablas largas, o un
  **tablero** con varias piezas. La plataforma valida y normaliza lo que manda Voi (si algo no cierra, se lo devuelve
  para corregir) y lo guarda en la conversación (`asistente_artefactos`).
- Diseño con el método de visualización: paleta categórica de marca **validada** (lectura y daltonismo), marcas finas,
  leyenda solo con 2 o más series, una sola escala por gráfico, «destacar» con el resto en gris, línea de meta y
  tooltips con todas las series. Cada pieza trae **Datos** (la tabla, ordenable), descarga en **CSV** y en **PNG**.
- Las tablas del chat se ven ordenadas (números a la derecha) y se pueden **ampliar en el lienzo**.

### Modo auditor (investigación de auditoría)

Quien tiene la utilidad **Auditoría de ventas** (el auditor, el superadmin, el analista…) puede convertir una conversación
en una **investigación** con un **informe destino**:

- **Cómo se entra:** desde el panel (chip **Modo auditor** del compositor o la tarjeta «Investigación de auditoría» de la
  bienvenida), desde un informe con **Investigar con Voi** (abre Voi con ese informe como destino, en una conversación
  nueva si la actual ya tenía mensajes), pidiéndoselo a Voi («entrá en modo auditor») o **aceptando la sugerencia de
  Voi**: si el modo está apagado y la persona está investigando (alertas, vendedores en riesgo, líneas sin uso, ventas
  dudosas), Voi pregunta antes de seguir con una tarjeta **«¿Activamos el modo auditor?»** (Activar / Ahora no;
  herramienta `proponer_modo_auditor`). Si la rechaza, no insiste en esa conversación. Se elige el informe (en Borrador o
  En revisión), se trabaja sin destino o se le pide a Voi que **prepare uno nuevo** (queda como destino solo).
- **Cambia la actitud de Voi:** en modo auditor es escéptico, incisivo y rápido. **Lo primero son las netas y las
  cargas de Ventas Netas**: empieza con la herramienta `alertas_del_corte` (un solo llamado: el último corte publicado
  con los vendedores críticos y en alerta media, los datos llamativos y los hallazgos automáticos, ya resumidos) y
  responde con eso, corto: una línea de conclusión, de 3 a 5 alertas con cifra y vendedor, hechos separados de
  hipótesis y un próximo paso. Si acompaña el barrido con un gráfico de netas o cargas lo decide el modelo por el
  contexto (una evolución o una concentración que una imagen explica mejor que una cifra); si alcanza con las cifras,
  no lo hace. Solo si el auditor quiere «urgar más» sigue con `ventas_del_mes` (líneas, cargas por
  día, un vendedor), el centro de comandos y los tickets. Se lo recuerda la plataforma en cada mensaje.
- **Se ve, y se ve que es el agente:** el panel, el lienzo y el botón de Voi **brillan**: un borde que late y pasa por
  los colores de Voicenter de a uno, con resplandor; el botón dice «AI VOI · Modo auditor»; en el chat, un separador
  «Voi entró en modo auditor · AUD-…»; arriba, una franja «**Voi en modo auditor** · El agente investiga con vos ·
  AUD-…» con el informe destino, **Cambiar** y **Salir**. Botones, modales y tarjetas mantienen la paleta neutra de la plataforma. Quien pidió
  menos movimiento ve el borde fijo.
- **Voi pregunta siempre:** cada mensaje le recuerda el modo y el destino; cada vez que muestra algo en el lienzo llama
  a `proponer_evidencia` y aparece una **tarjeta con una casilla por pieza** (todas, algunas o ninguna), con el título
  y la lectura editables. Solo se suma lo elegido (el servidor valida que la elección sea un subconjunto de lo
  propuesto); «No sumar nada» no suma nada. La tarjeta muestra después con qué número quedó cada figura.
- **Desde el lienzo, directo:** cada pieza (y **cada parte de un tablero**) tiene **Al informe**; abajo, una barra con lo
  elegido y **Sumar al informe** abre una hoja para retocar título y lectura y elegir el **hallazgo** que respaldan.
  Las piezas que ya están en el informe muestran «Figura N» (no se duplican).
- **Ir al informe:** el botón de la tarjeta, de la hoja y de la franja **cierra el lienzo** (tapaba la pantalla), abre
  la pestaña Evidencia del informe y lo avisa («Voi abrió AUD-… · Evidencia · Volver»); el lienzo se vuelve a abrir
  desde el panel.
- **Confidencialidad:** nunca se suma una pieza de otra persona ni una de una conversación que usó **Facturación**
  (queda marcada «Confidencial» y el servidor la rechaza): el informe de auditoría lo ven perfiles sin Facturación.
- El estado vive en su propia columna (`asistente_conversaciones.investigacion`) y llega al navegador por el mismo
  canal en vivo (evento `investigacion`). Todo queda en el registro de auditoría (`asistente_modo_auditor`,
  `asistente_evidencia_informe`) y en la bitácora del informe.

### Modo informe diario (armar el informe con Voi)

Quien prepara el **informe diario** (coordinador, sub gerente, superadmin) puede armarlo **con Voi**, en una conversación
que pasa a **modo informe diario** con el borrador del día como destino de las figuras:

- **Cómo se entra:** con **Armar con Voi** (en Mis informes y en la sección Figuras del editor), con el chip **Informe
  diario** del compositor o la tarjeta «Informe diario con Voi» de la bienvenida, o pidiéndoselo a Voi («armemos el
  informe diario», «ayudame con el informe de ayer»; herramienta `modo_informe_diario`, con fecha de hoy o de hasta 7
  días atrás). El borrador se crea si no existe y Voi arranca solo. No necesita informe de auditoría ni la utilidad de
  Auditoría: es un modo distinto del modo auditor (una conversación tiene uno u otro).
- **Qué hace Voi:** trabaja un paso por vez y en pocas líneas: mira los datos del día (llamadas, ventas, proyección,
  coaching), propone los resultados de Pospago y GPON, el resumen y las métricas críticas con compromiso y los carga
  con `preparar_informe_diario` cuando el usuario dice; cada gráfico o tablero que muestra en el lienzo lo ofrece como
  **figura del informe** con `proponer_evidencia` (la misma tarjeta con casillas del modo auditor, con el destino
  «Informe diario · dd/mm» y la lectura «para quien recibe el informe»). **Nunca firma**: al final abre el informe para
  que el usuario lo revise y lo firme. Después de responder un dato, ofrece con botones **Armar un tablero**, **Ver un
  gráfico**, **Sumar al informe diario** y **Ver en la pantalla**.
- **Se ve, y se ve que es el agente:** el panel, el lienzo y el botón de Voi llevan un borde más sobrio que el del modo
  auditor: late despacio entre el púrpura y el cyan de la marca (no es una alerta, es un trabajo en curso); el botón
  dice «AI VOI · Modo informe diario»; la franja dice «**Voi en modo informe diario** · El agente arma con vos el informe
  del dd/mm (borrador)», con **Salir** y el acceso al informe; en el chat, el separador «Voi entró en modo informe
  diario · informe del dd/mm» (y «Voi salió…» al terminar); en el informe, la sección Figuras avisa que Voi, el agente,
  está trabajando en él.
- **Agregar con un toque:** el botón dice siempre **«Agregar al informe diario»**: en la tarjeta que propone Voi, en la
  tarjeta de cada pieza del chat (la agrega directo, sin abrir el lienzo), en cada pieza o parte de un tablero del
  lienzo y en la hoja de abajo. **Ir al informe** cierra el lienzo y lleva a la sección Figuras del informe (con el
  aviso «Voi abrió Informe diario · dd/mm · Figuras»), que se actualiza sola cada vez que Voi suma algo.
- **En el informe:** la sección **5. Figuras** del editor muestra cada figura numerada con el gráfico dibujado igual que
  en el lienzo, título y lectura editables (se guardan al salir del campo), **Quitar** y el estado de la **captura para
  el PDF**: el navegador convierte cada gráfico (barras, columnas, líneas, área, apiladas) en PNG y lo sube; el servidor
  lo procesa sin metadatos y lo guarda en el disco persistente. Al firmar, las figuras quedan fijas y dentro del código
  de verificación; en la lectura y en el PDF salen como «Figura N · título».
- **Imágenes del autor:** además de lo que suma Voi, el autor agrega capturas o fotos como figuras desde la misma
  sección con **«Agregar imagen al informe»** (el selector rápido del navegador, que abre en el Escritorio y recuerda
  la carpeta, con el clásico de respaldo), **«Capturar pantalla»**, arrastrar o **Ctrl + V** (`POST
  …/figuras/imagen`): se procesan en un subproceso aislado, sin metadatos, en el disco persistente, y su huella entra
  en el código de verificación al firmar. Voi nunca sube archivos: eso lo hace siempre la persona.
- **Tableros e indicadores en el PDF:** cada figura se captura en el navegador como imagen (gráficos por su SVG;
  indicadores, tablas, donas y tableros completos se dibujan en un canvas desde su especificación), así el PDF muestra
  lo mismo que la pantalla; si no hay captura, van sus datos en tabla.
- **Confidencialidad:** nunca se suma una pieza de otra persona ni una de una conversación que usó Facturación. Solo el
  autor del informe suma, edita o quita figuras, y solo mientras es borrador; el superadmin ve las figuras pero no las
  cambia.
- El estado vive en la misma columna que el modo auditor (`asistente_conversaciones.investigacion`, con `tipo`), llega
  al navegador por el evento `investigacion` y queda en el registro de auditoría (`asistente_modo_informe_diario`,
  `asistente_figura_informe_diario`, `informe_diario_figura_quitada`).

### Base de conocimiento con citas

El superadmin sube **manuales, políticas, procedimientos y criterios** (PDF con texto, Word .docx, .txt o .md, hasta
20 MB) en **Administración → Asistente IA → Conocimiento** y elige **quién los puede consultar**: todos los que usan Voi,
solo quienes tienen ciertos **permisos** (por ejemplo, los criterios de comisiones solo para **Facturación**) o solo el
superadmin.

- El texto se extrae en un **subproceso aislado** (tiempo y memoria acotados: un archivo dañado no tumba el servidor),
  con `pypdf` para los PDF y lectura directa del XML para Word (se rechazan entidades XML y «zip bombs»). Se descartan
  encabezados y pies repetidos, se detectan títulos de sección y se parte en **fragmentos** de ~1.100 caracteres con su
  **página** y **sección**. Se guarda el original comprimido.
- Voi busca con **BM25** (sin tildes, sin palabras vacías y con recorte de plurales) **solo en los documentos activos que
  esa persona puede ver**; la herramienta se describe por sesión con la lista de sus documentos y, si no tiene ninguno,
  no la recibe.
- Cada dato que sale de un documento va con su **cita** (`[Manual de comisiones, p. 4](cita:frag_…)`): en el panel es un
  chip que abre el **pasaje exacto** y permite **descargar** el documento. Fuera de su alcance, la cita y la descarga
  responden como si no existieran.
- En la consola: subir, ver **el texto que lee Voi**, editar título, descripción y alcance, activar o desactivar,
  **reemplazar** el archivo, borrar y **probar la búsqueda**. Todo queda en la auditoría.

### Facturación en Voi (confidencial)

Las herramientas y la habilidad de Facturación existen solo en las sesiones de quien tiene la utilidad **Facturación**
(superadmin y Sub gerente: es restringida) y nunca en modo auditoría; el permiso se vuelve a leer en cada uso. Voi
analiza **liquidaciones** (drivers, cohortes, PFI, documentación faltante), **compara meses** con la descomposición del
cambio, cruza la **calidad por fecha de venta**, explica los **criterios** de Pospago y GPON (cuotas 1 y 2, bonos,
recálculo, residual, legajos, chargeback de 180 días, mora, recupero) leídos de la misma fuente que los simuladores, y
corre el **simulador** de la plataforma con escenarios («¿qué pasa si…?»). Los montos no se anotan en la memoria.

### La memoria («Lo que recuerdo»)

Cada conversación empieza de cero: la memoria es **lo único que Voi se lleva de una conversación a otra**. Guarda
preferencias (cómo le gusta ver los datos, qué métricas sigue), su equipo y objetivos y en qué quedó un trabajo. Se
llena cuando el usuario dice «Recordá que…» o cuando Voi aprende algo útil (y lo avisa: «Lo anoto para la próxima»). Es
**privada** (solo esa persona y sus conversaciones) y cada nota se puede borrar desde el panel.

### Voi como guía de la plataforma

Voi no solo responde: **maneja la plataforma con el usuario**. La fuente única es el **catálogo de pantallas y guías**
(`backend/app/asistente/pantallas.py`): cada pantalla con su ruta, qué hace, qué utilidad exige, cómo la nombra la gente
(«subir corte», «centro de comandos», «mi perfil»), qué elementos se pueden resaltar y la **pista** que Voi sugiere ahí;
y cada **guía** paso a paso (subir el corte de Claro, subir cortes de llamadas, publicar, calcular el SPH, preparar y
firmar el informe diario, enviar un ticket, trabajar alertas, crear un informe de auditoría, subir evidencia, armar
equipos, cargar objetivos, vincular operadores, subir una liquidación, cambiar la foto o la contraseña, subir un
documento a la base de conocimiento). Todo se filtra por los **permisos reales** del usuario: Voi nunca lleva a nadie a
una pantalla que no puede ver y, si no puede, le dice qué utilidad le falta y quién la asigna. Las frases se comparan en
forma canónica (sin tildes, verbos en infinitivo, sin palabras vacías): «¿cómo subo el corte?» encuentra la guía de
subir el corte.

- **`abrir_pantalla`**: Voi navega por el usuario (evento `navegar` por SSE) y puede resaltar un botón o una zona. En
  la plataforma aparece un aviso «Voi abrió … · Volver»; en el teléfono el panel se cierra para que se vea la
  pantalla. Acepta rutas exactas que devolvió otra herramienta (con id o pestaña). En el chat queda la tarjeta «Abrí …
  · Abrir de nuevo».
- **`guiar`**: abre la pantalla donde se hace la tarea y muestra la **guía flotante** (Paso n de N · Anterior ·
  Siguiente · Listo) que resalta con un anillo cyan el elemento de cada paso (los marcados con `data-voi="…"`: archivo,
  procesar, publicar, calcular, preparar, enviar, crear, subir, capturar, objetivos, asignar, vincular, foto,
  contraseña, documento, coaching). La guía sigue al usuario si cambia de pantalla («Volver a la pantalla de la guía»)
  y queda en el chat para volver a abrirla. Subir archivos lo hace siempre el usuario; Voi le marca dónde.
- **`ofrecer_opciones`**: una pregunta con **2 a 4 botones**; tocar uno manda su mensaje (y abre su pantalla, si
  trae). Sirve para aprobar un paso puntual («¿Lo preparo?» → «Sí, preparalo»), elegir un camino o, cuando la persona
  no sabe qué hacer, las tres cosas más útiles para su perfil y su pantalla. Después de responder quedan apagados con
  la elegida marcada. Las acciones que afectan a otros siguen pidiendo su tarjeta de **Aprobar**. Después de
  responder un dato (llamadas, ventas, SPH, coaching, tickets…), Voi ofrece **Armar un tablero** (empieza a trabajar
  en el lienzo con los datos que ya consultó), **Ver un gráfico**, **Ver en la pantalla** y, en modo informe diario,
  **Sumar al informe diario**.
- **Botón «AI VOI» y burbuja:** el botón de la cabecera **late** suave mientras está cerrado (naranja y más rápido
  cuando espera una aprobación, con el subtítulo «Esperá tu OK») y, al llegar a una pantalla, debajo aparece una
  **burbuja** con la pista de Voi para esa pantalla («¿Te guío para subir el corte de Claro?» con un botón que manda
  la pregunta), una vez por pantalla y sesión, nunca mientras hay una guía o Voi acaba de navegar. La bienvenida del
  panel ofrece primero las sugerencias de la pantalla actual. Quien pidió menos movimiento ve halos fijos.
- `GET /asistente/pantallas` devuelve al navegador las pantallas que esa persona puede abrir con su pista, sus
  sugerencias, sus guías y sus anclas.

### El panel

- Botón **AI VOI** en la cabecera y **Ctrl/⌘ + K**. En pantallas anchas se acopla a la derecha y corre la página (la
  cabecera se compacta); en el teléfono ocupa toda la pantalla. Vive en la raíz de la app: sigue abierto al navegar.
- El **isotipo de Voicenter redibujado en SVG** (los mismos 25 puntos): quieto, **pensando** (una onda recorre los
  puntos) o **hablando** (más rápida). Quien pidió menos movimiento lo ve quieto.
- Respuesta en vivo, pasos de lo que consultó, tarjetas de acción (**Aprobar / Cancelar**), botones de opciones,
  guías y pantallas abiertas, piezas del lienzo, citas, enlaces que navegan dentro de la plataforma, historial (fijar,
  renombrar, quitar), memoria, sugerencias según la pantalla y el perfil y comandos con `/` (`/nueva`, `/historial`,
  `/lienzo`, `/memoria`, `/ayuda`). El botón avisa si llegó una respuesta o si una acción espera aprobación.

### Consola del superadmin (`/admin/asistente`)

- **Resumen y consumo:** conexión, versión publicada (publicar, forzar versión nueva, probar conexión), gasto del mes
  contra el presupuesto, gasto por día, por usuario y «de qué se habla» (herramientas usadas).
- **Configuración y topes:** encendido general; **razonamiento de Voi** (Rápido · **Equilibrado** · Profundo: cuánto
  piensa antes de responder; vale para las conversaciones nuevas); presupuesto del mes (US$ 150, aviso al 80 %; al llegar
  al tope Voi se pausa para todos menos el superadmin), por conversación (US$ 1, tope duro que aplica Anthropic), por
  usuario y día (US$ 5; el superadmin no tiene) y mensajes por minuto; confirmar también los borradores propios.
- **Conversaciones** de todos con la transcripción completa (contexto, pedido y respuesta de cada herramienta, piezas
  del lienzo, costo y tokens). Cada lectura de una conversación ajena queda en la auditoría.
- **Acciones** recientes, **Conocimiento** (la base de documentos) y **Herramientas y habilidades** (qué puede hacer
  Voi, con qué nivel y qué permiso exige).

El costo es el **precio de lista** que informa Anthropic para cada sesión (tokens + US$ 0,08 por hora de ejecución),
sumado por usuario y día.

### Puesta en marcha en Render

1. En la consola de Anthropic (platform.claude.com) crear una **API key** de la organización.
2. Render → el servicio → **Environment** → `ANTHROPIC_API_KEY` = la clave → guardar (el servicio se reinicia).
3. Al arrancar, Voi se publica solo (entorno, habilidades y agente). Verificarlo en **Administración → Asistente IA**
   («Agente publicado · versión N») y con **Probar conexión**. Cada despliegue que cambia el agente o sus habilidades
   publica una versión nueva sola.
4. Opcional: registrar un webhook en la consola de Anthropic hacia `https://<dominio>/api/v1/asistente/webhooks/anthropic`
   y cargar su secreto en `ANTHROPIC_WEBHOOK_SIGNING_KEY` (la firma se verifica con el estándar Standard Webhooks).

Sin la clave, Voi se ve pero avisa que no está conectado. **Datos:** las conversaciones, lo que devuelven las
herramientas y los pasajes de documentos que Voi consulta viajan a Anthropic (Managed Agents no es elegible para *Zero
Data Retention*); la plataforma guarda su propia copia para la consola.

### Desarrollo y pruebas

- `ASISTENTE_SIMULADOR=true` usa un motor que imita a Managed Agents (mismos eventos y formas de datos, reglas simples
  por palabras clave: consultas, lienzo y tableros, documentos con citas, facturación, acciones, modo auditor con su
  tarjeta de evidencia, y la guía: «llevame a…», «¿cómo subo…?» y «¿qué puedo hacer?» con botones) sin llamar a
  Anthropic; en producción se ignora. `ASISTENTE_SIMULADOR_DEMORA` regula la velocidad.
- `tests/test_asistente.py`: permisos y modo auditoría, publicación con versiones, ciclo completo de una conversación,
  confirmación (doble clic, cancelar, seguir escribiendo), memoria, topes, stream en vivo, recuperación después de un
  corte, webhook firmado, simulador apagado en producción y consola.
- `tests/test_asistente_fase2.py`: validación del lienzo, extracción de PDF/Word/texto (encabezados repetidos,
  secciones, archivos rotos y entidades XML), búsqueda y citas con alcance por permisos (subir, desactivar, reemplazar,
  borrar, descargar), Facturación solo para superadmin y Sub gerente, lienzo en una conversación y las acciones nuevas
  (seguimiento de tickets, comentar el informe diario, preparar auditorías y agregar hallazgos).
- `tests/test_asistente_guia.py`: el catálogo de pantallas y guías por permiso (qué ve cada perfil, búsqueda con las
  palabras de la gente, rutas dinámicas e inválidas, anclas que existen), la validación de destinos y opciones, y el
  ciclo completo con el simulador: abrir una pantalla, la guía paso a paso, los botones de opciones (elegir uno manda
  su mensaje), el rechazo sin permiso y lo que ve el superadmin en la consola.
- `tests/test_auditoria_evidencias.py`: imágenes sin metadatos (EXIF y GPS) y rechazos, imágenes en el disco persistente
  servidas solo con Auditoría, edición, orden, figuras fijas al cerrar y borrado de archivos; modo auditor (quién lo
  activa, informe destino, contexto para Voi), la tarjeta con elección (inválida, ninguna, una con título retocado),
  el camino desde el lienzo, el índice del informe y el bloqueo de piezas con datos de Facturación.

### API

| Endpoint (`/api/v1/asistente…`) | Qué hace |
|---|---|
| `GET /estado` | Disponibilidad, modo, herramientas y sugerencias del usuario |
| `GET /pantallas` | Las pantallas que el usuario puede abrir, con la pista de Voi, las sugerencias, las guías y las anclas de cada una |
| `GET/POST /conversaciones` | Lista / nueva (con el primer mensaje) |
| `GET/PATCH/DELETE /conversaciones/{id}` | Transcripción (con las piezas del lienzo) / renombrar o fijar / quitar de la lista |
| `POST /conversaciones/{id}/mensajes` · `/detener` | Mensaje (con la pantalla) / detener la respuesta |
| `GET /conversaciones/{id}/eventos` | Eventos en vivo (SSE) |
| `POST /acciones/{id}/confirmar` · `/cancelar` | Resolver una acción pendiente (`ajustes`: lo que el usuario eligió en la tarjeta, p. ej. qué piezas suma al informe) |
| `GET /memoria` · `DELETE /memoria/{id}` | Memoria del usuario |
| `GET /citas/{fragmento}` · `GET /documentos/{id}/archivo` | Pasaje de una cita / descarga del documento (si está a su alcance) |
| `POST /conversaciones/{id}/investigacion` | Modos: activar el modo auditor (`tipo: auditor`, con `auditoria_id`, id o código AUD-…) o el modo informe diario (`tipo: informe_diario`, con `fecha` o `informe_id`; crea el borrador si no existe), o desactivar el activo |
| `POST /evidencias` | Sumar piezas del lienzo (o partes de un tablero) como figuras de un informe de auditoría (`auditoria_id`) o del informe diario (`informe_diario_id`) |
| `POST /webhooks/anthropic` | Webhook firmado de Anthropic (opcional) |
| `GET /admin/estado` · `PUT /admin/config` · `POST /admin/publicar` · `POST /admin/probar` | Consola: estado, configuración (topes y razonamiento), publicación y prueba |
| `GET /admin/consumo` · `/admin/conversaciones` · `/admin/conversaciones/{id}` · `/admin/acciones` | Consola: consumo, conversaciones (lectura auditada) y acciones |
| `GET/POST /admin/documentos` · `PATCH/DELETE /admin/documentos/{id}` | Base de conocimiento: listar, subir, editar (alcance, activo), borrar |
| `POST /admin/documentos/{id}/archivo` · `GET /admin/documentos/{id}/fragmentos` · `POST /admin/documentos/buscar` | Reemplazar el archivo, ver el texto extraído y probar la búsqueda |

### Próximas etapas

3. Archivos del espacio de trabajo (Excel y PDF generados por Voi), subagentes y misiones con resultado esperado.
4. Misiones programadas con avisos y la consola completa (temas, brechas, versiones).
5. Evaluaciones, conciliación de costos, migración del agente de Facturación a Voi y retención/borrado automático.

## Sistema de login y seguridad de acceso

La pantalla de ingreso lleva el **logo de Voicenter en movimiento** (`components/LogoAnimado.tsx`): los 25 puntos del
isotipo se arman uno a uno, laten como un ecualizador de voz y se desarman en un ciclo continuo, con la marca, sobre
el mural de puntos de la fachada que respira despacio. Es SVG con animaciones CSS (solo `transform` y `opacity`, en la
GPU): no es un video, pesa unos pocos KB, no descarga nada y quien pidió menos movimiento en su sistema lo ve quieto.
En el teléfono aparece en chico sobre el formulario.

### Transiciones (movimiento de la interfaz)

Una sola familia de curvas para todo (`--mov-entrada`, `--mov-salida`, `--mov-estandar` en `globals.css`, las de
desaceleración, aceleración y estándar que usan los sistemas de Apple y Google): lo que entra desacelera, lo que sale
acelera. Siempre corto (180–320 ms), plano (sin giros ni perspectiva) y con poco recorrido, para que nada parezca
caerse ni flotar.

- **Las pantallas aparecen** con un fundido corto (0,24 s) en `AppShell` (`.pagina-entra`).
- **Cambiar de pantalla** usa la API de View Transitions del navegador (`lib/transiciones.ts`) con el patrón de ejes
  compartidos que recomienda Chrome: la pantalla que se va se funde en 100 ms y se corre 16 px a la izquierda; la
  nueva se funde después (220 ms) mientras llega desde la derecha; 300 ms en total. La cabecera y el panel de Voi
  tienen su propio nombre de transición y quedan quietos. Se intercepta el clic en fase de captura y
  `preventDefault()` frena la navegación propia del `Link` de Next (que respeta `defaultPrevented`) sin saltarse su
  `onClick`; la transición espera a que cambie la ruta (tope 700 ms). Sin la API, o con «reducir movimiento», la
  pantalla nueva solo aparece con su fundido. Ctrl/⌘-clic, pestañas con `#`, descargas y enlaces externos no se tocan.
- **Voi entra y sale deslizándose** desde la derecha (desde abajo en el teléfono), solo con `transform` y sin
  fundido: 0,32 s al entrar y 0,22 s al cerrarse (sigue montado ese instante, `voi.cerrando`); la página acoplada se
  corre con la misma curva y el mismo tiempo, así se mueven juntos. El lienzo aparece con un fundido y un leve
  crecimiento; los diálogos y la burbuja de Voi, igual (sin desplazarse).

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
la base PostgreSQL (plan pago: tiene respaldos), crear el Web Service con runtime Docker y disco en
`/var/data`, y setear `DATABASE_URL`, `SECRET_KEY`, `SUPERADMIN_EMAIL` y
`SUPERADMIN_PASSWORD`. `DATABASE_URL` se convierte sola a `postgresql+asyncpg://`. Para Voi, sumar `ANTHROPIC_API_KEY`
(ver [Puesta en marcha en Render](#puesta-en-marcha-en-render)).

- **Qué se guarda dónde:** PostgreSQL guarda todas las tablas, los informes y lo necesario para recalcularlos
  (Ventas Netas, Productividad y una copia de cada liquidación de Facturación). El disco (`UPLOAD_DIR`) guarda los
  archivos originales y las fotos de perfil. `UPLOAD_DIR` tiene que quedar dentro del mount path del disco; si en
  producción quedó afuera y hay un solo disco montado, el sistema usa `<disco>/uploads` y lo avisa.
- **Administración → Sistema** (solo superadmin): estado del almacenamiento (base, disco, espacio y qué se puede
  recalcular sin el disco), con lo que haya que corregir.

## Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). Las obligatorias en producción:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Connection string de PostgreSQL |
| `SECRET_KEY` | Firma de los JWT. 64 caracteres hex aleatorios |
| `SUPERADMIN_EMAIL` | Email del superadmin |
| `SUPERADMIN_PASSWORD` o `SUPERADMIN_PASSWORD_HASH` | Credencial del superadmin |

Opcionales:

| Variable | Descripción |
|---|---|
| `OPENAI_API_KEY` | Agente de Facturación |
| `ANTHROPIC_API_KEY` | Voi, el agente de la plataforma (Claude Managed Agents). Sin ella Voi se ve pero avisa que no está conectado |
| `ANTHROPIC_WEBHOOK_SIGNING_KEY` | Secreto `whsec_…` del webhook de Anthropic para Voi |
| `ASISTENTE_MODELO` | Modelo de Voi (por defecto `claude-sonnet-5-5`) |
| `ASISTENTE_SIMULADOR` | Solo desarrollo: Voi con un motor simulado, sin llamar a Anthropic (se ignora en producción) |

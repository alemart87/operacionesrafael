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
  y la pantalla indica qué hace falta.
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
  5. **Figuras**: gráficos, indicadores, tablas o tableros del **lienzo de Voi** que el autor suma al informe (con
     **Armar con Voi**, desde la tarjeta que Voi propone en el chat o directo desde el lienzo; ver [Modo informe
     diario](#modo-informe-diario-armar-el-informe-con-voi)). Cada figura queda numerada, con título y lectura
     editables y su especificación congelada: en la pantalla se vuelve a dibujar igual aunque los datos cambien. El
     navegador captura cada gráfico como imagen para el PDF («Imagen lista para el PDF»; indicadores, tablas y
     tableros van con sus datos). Hasta 12 por informe; se quitan con un toque.
  6. **Seguimiento de compromisos**: los compromisos abiertos de informes anteriores; en cada informe se marcan
     cumplido, en curso o no cumplido, con una nota. Cumplido y no cumplido los cierran.
  7. **Firma**: nombre y cargo (editable; se recuerda) y, si se quiere, la **firma manuscrita** dibujada con el
     dedo o el mouse (PNG validado con Pillow, hasta 120 KB; se guarda para los próximos informes).
- **Guardado automático** del borrador (a 1,2 s del último cambio), con aviso si se intenta salir sin guardar.
- **Firmar**: hacen falta Pospago, GPON y el resumen (20 caracteres o más). El informe queda cerrado con un
  **código de verificación** (SHA-256 del contenido, el nombre, el cargo, la hora y la firma): si alguien lo
  modificara en la base, el código deja de coincidir y el superadmin lo ve. Después solo se agregan comentarios.
- **PDF** (`reportlab`, A4, con el logo y las tipografías de la marca, Manrope y Barlow Condensed, licencia
  OFL, en `backend/app/assets/fonts`): encabezado, resultados con su cumplimiento y el día anterior, datos
  importados, resumen, métricas críticas, **figuras** (la captura del gráfico o, si no la hay, sus datos en una
  tabla), seguimiento de compromisos y la firma con el código. Un borrador sale
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
     botones) y, solo con Facturación, **liquidaciones, comparativos, calidad por fecha, criterios y simulador**
     Pospago/GPON.
  2. **Lo propio** (corre sola y queda registrada; el superadmin puede pedir confirmación): preparar el **borrador** del
     informe diario con datos importados y el **seguimiento de sus compromisos**; preparar un **informe de auditoría**
     en borrador (con los cortes de Ventas Netas de los meses pedidos) y **agregarle hallazgos**. Voi nunca firma ni
     cierra.
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
- **Se ve:** el panel, el lienzo y el botón de Voi **brillan**: un borde que late y pasa por los colores de Voicenter de
  a uno, con resplandor; en el chat, un separador «Modo auditor activado · AUD-…»; arriba, una franja con el informe
  destino, **Cambiar** y **Salir**. Botones, modales y tarjetas mantienen la paleta neutra de la plataforma. Quien pidió
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
- **Se ve:** el panel, el lienzo y el botón de Voi llevan un borde más sobrio que el del modo auditor: late despacio
  entre el púrpura y el cyan de la marca (no es una alerta, es un trabajo en curso); la franja dice «Modo informe diario
  · Informe del dd/mm · borrador», con **Salir** y el acceso al informe; en el chat, el separador «Modo informe diario
  activado · informe del dd/mm».
- **Desde el lienzo, directo:** **Al informe** en cada pieza o parte de un tablero y **Sumar al informe** abren la misma
  hoja que en modo auditor, sin hallazgo. **Ir al informe** cierra el lienzo y lleva a la sección Figuras del informe
  (con el aviso «Voi abrió Informe diario · dd/mm · Figuras»), que se actualiza sola cada vez que Voi suma algo.
- **En el informe:** la sección **5. Figuras** del editor muestra cada figura numerada con el gráfico dibujado igual que
  en el lienzo, título y lectura editables (se guardan al salir del campo), **Quitar** y el estado de la **captura para
  el PDF**: el navegador convierte cada gráfico (barras, columnas, líneas, área, apiladas) en PNG y lo sube; el servidor
  lo procesa sin metadatos y lo guarda en el disco persistente. Al firmar, las figuras quedan fijas y dentro del código
  de verificación; en la lectura y en el PDF salen como «Figura N · título».
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

Todo lo configura el superadmin en **Seguridad** (`/admin/seguridad`) y se hace
cumplir en el servidor en **cada pedido** (`api/deps.py::get_current_user`), así
que un cambio rige al instante, también para las sesiones abiertas.

- **Sesiones en el servidor** (`user_sessions`): cada token lleva el id de su
  sesión (`sid`). Se cierran solas por inactividad (60 min por defecto) y por
  duración máxima (12 h). El superadmin ve las sesiones activas y puede cerrar una,
  todas las de un usuario o todas menos la suya. Desactivar un usuario, resetearle
  la contraseña o el 2FA cierra sus sesiones. El navegador avisa 2 minutos antes del
  cierre por inactividad ("¿Seguís ahí?").
- **Bloqueo por intentos fallidos** persistente en la base (`users.failed_attempts`,
  `locked_until`): N intentos en una ventana bloquean la cuenta X minutos (0 =
  hasta que el superadmin la desbloquee). Además queda un freno en memoria por IP.
- **Política de contraseñas**: largo mínimo, mayúsculas/minúsculas, número,
  símbolo, vencimiento, no repetir las últimas N y cambio obligatorio en el primer
  ingreso y tras un reseteo (`/cambiar-contrasena`).
- **Segundo factor (TOTP)** opcional y recomendado: se activa desde *Mi perfil*
  con una app autenticadora, con 8 códigos de recuperación. El secreto se guarda
  cifrado (Fernet derivado de `SECRET_KEY`); los códigos, hasheados. También lo
  puede activar el superadmin de `.env`.
- **Horarios por perfil**: franjas semanales por perfil, feriados y zona horaria.
  Modos: *desactivado*, *solo registrar* (deja entrar y audita
  `acceso_fuera_de_horario`) o *bloquear* (no deja ingresar y cierra la sesión al
  terminar la franja, con aviso previo). El superadmin puede dar **excepciones**
  por usuario con vencimiento (máx. 31 días) y motivo.
- El **superadmin** de `.env` nunca queda afuera: está exento de horario y de
  bloqueo de cuenta.
- La configuración vive en la fila `security_settings` (id 1). `SECURITY_DEFAULTS`
  (JSON parcial) permite cambiar los valores por defecto (lo usan los tests).
- Todo queda auditado: logins, fallidos, bloqueos, 2FA, cierres de sesión,
  excepciones, cambios de configuración, altas, bajas y reseteos.
- Los usuarios se desactivan (baja lógica); nunca se borran, para conservar la auditoría.

### Endpoints

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/v1/auth/login` | Público |
| POST | `/api/v1/auth/login/2fa` | Público (desafío del login + código) |
| POST | `/api/v1/auth/refresh` · `/logout` | Sesión vigente |
| GET | `/api/v1/auth/politica` | Logueado (política de contraseñas) |
| GET · POST | `/api/v1/auth/2fa` · `/2fa/iniciar` · `/2fa/activar` · `/2fa/desactivar` | Logueado |
| GET · PATCH | `/api/v1/auth/me` | Logueado |
| POST | `/api/v1/auth/change-password` | Logueado (no superadmin) |
| POST | `/api/v1/auth/me/photo` | Logueado (no superadmin) |
| GET · POST | `/api/v1/users` | Superadmin |
| PATCH · DELETE | `/api/v1/users/{id}` | Superadmin |
| POST | `/api/v1/users/{id}/reset-password` · `/photo` | Superadmin |
| GET | `/api/v1/audit` · `/api/v1/audit/users-map` | Superadmin |
| GET · PUT | `/api/v1/seguridad/config` | Superadmin |
| GET | `/api/v1/seguridad/sesiones` · `/usuarios` | Superadmin |
| POST | `/api/v1/seguridad/sesiones/{sid}/cerrar` · `/sesiones/cerrar-todas` | Superadmin |
| POST | `/api/v1/seguridad/usuarios/{id}/cerrar-sesiones` · `/desbloquear` · `/reset-2fa` · `/forzar-cambio` | Superadmin |
| PUT · DELETE | `/api/v1/seguridad/usuarios/{id}/excepcion` | Superadmin |
| GET · PUT | `/api/v1/perfiles` · `/api/v1/perfiles/{perfil}` | Superadmin |
| GET | `/api/v1/perfiles/catalogo` | Superadmin |
| GET | `/api/v1/operativas` | Logueado (solo las que puede abrir) |
| GET | `/api/v1/televentas-claro` | `televentas_claro.ver` |
| GET | `/api/v1/televentas-claro/ventas-netas/reports[/{id}][/export.xlsx]` | `televentas_claro.ventas_netas` |
| POST · DELETE | `/api/v1/televentas-claro/ventas-netas/uploads` · `/reports/{id}[/publish\|/unpublish\|/reprocess]` | `televentas_claro.ventas_netas_gestion` |
| * | `/api/v1/televentas-claro/auditoria/*` (fuentes, parametros, riesgos, informes, hallazgos, seguimientos, estado) | `televentas_claro.auditoria` |
| * | `/api/v1/televentas-claro/supervision/*` (resumen, tablero, coaching, gestion, **registro**, comando, tickets…) | `televentas_claro.supervision` (lo que cambia algo, además `supervision_gestion`, `tickets` u `operadores`) |
| * | `/api/v1/televentas-claro/supervision/portal/*` (portal, coaching, **registro**, bitácora, tickets) | `televentas_claro.portal_supervisor` (solo lo del supervisor que entra) |
| * | `/api/v1/televentas-claro/informe-diario/*` (preparar, guardar, importar, firmar, PDF, comentar, firma; `figuras/{id}` editar y quitar, `figuras/{id}/imagen` subir y ver la captura) | `televentas_claro.informe_diario` (cada informe: su autor y el superadmin; las figuras las cambia solo el autor del borrador) |
| GET · PUT | `/api/v1/televentas-claro/informe-diario/seguimiento` · `/palabras` | Superadmin |
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

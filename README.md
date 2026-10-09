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
│   │   └── operativas/          # código de cada operativa (ROUTERS + WORKERS)
│   │       └── televentas_claro/
│   │           ├── router.py    # portada de la operativa
│   │           ├── fuentes.py   # qué informe de Productividad / Ventas Netas vale cada día y cada mes
│   │           ├── ventas_netas/ # submódulo: api · models · schemas · parser · analyzer · exports · jobs
│   │           ├── sph/         # submódulo SPH estimado: api · models · analyzer
│   │           ├── supervision/ # submódulo Supervisión: api · coaching_api · tickets_api · comando_api · models · calculo · scoring · coaching · impacto · alertas · tickets · sla · comando · operadores · migraciones
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
| Portal del supervisor (restringida) | 🔒 | 🔒 | 🔒 | ✓ | 🔒 | 🔒 | 🔒 |
| Auditoría de ventas | ✓ | ✓ | | 🔒 | ✓ | ✓ | |
| Facturación (restringida) | ✓ | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |

- **Sub gerente:** todos los módulos, incluida Facturación.
- **Controller:** todos los módulos menos Facturación; como cualquier usuario, puede
  tener varias operativas asignadas.
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
  cargas pendientes no traen POS y se atribuyen por `VENDEDOR_LEGAJO`.
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

SPH = ventas **netas** por hora conectada. Cruza dos módulos que ya existen, sin subir
archivos nuevos: las horas de los informes de **Productividad** y las netas del informe
de **Ventas Netas** del mes. Código en `backend/app/operativas/televentas_claro/sph/`.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Informes SPH | `/televentas-claro/sph` | **Calcular SPH** por día, semana, mes o rango (ver qué días cuentan y qué falta subir), filtros por tipo, publicar/despublicar |
| Informe | `…/sph/informes/{id}` | SPH de la operación, SPH por día (períodos), ranking por asesor, cruce de nombres, netas sin asesor, tabla de asesores (CSV) |
| Vínculos | `…/sph/vinculos` | Vínculos agente → vendedor corregidos a mano |

- **Períodos:** un día, una semana (lunes a domingo), un mes o un rango de hasta 62
  días. Se suma día por día: **cuenta** cada día con informe de Productividad y que el
  corte de ventas de su mes ya alcanza; los demás se informan (y el mes en curso se
  puede recalcular a medida que llegan datos). Cada neta se atribuye al asesor solo
  los días en que estuvo conectado.
- **Fuentes** (`fuentes.py`, las mismas que usa Supervisión): cada planilla de Ventas Netas
  trae las ventas de todo el mes hasta su corte, así que **la de corte más nuevo reemplaza
  a las anteriores**, publicada o no (a igual corte, la publicada). De las llamadas, el
  informe del día que llega más lejos (corte final más tardío; a igual corte, el
  publicado): un día publicado a mitad de jornada no deja afuera las horas de la tarde.
  Si se usó un borrador, queda avisado.
- **Netas del día:** líneas DDI cuya **fecha de venta** (de la carga; si falta, la de
  carga) es ese día, cruzadas con las horas de **ese mismo día**: las llamadas del 10/10
  van contra las ventas del 10/10 que trae la planilla subida el 11/10 (corte del 10),
  aunque todavía no esté publicada. Se leen de la planilla del mes del día y, para las
  ventas de las últimas dos semanas del mes, de la del **mes siguiente**: lo vendido a fin
  de mes y activado en los primeros días del otro mes viene en esa planilla y suma al día
  de la venta (cada línea, una sola vez). Las netas de
  un día se siguen activando hasta dos semanas después: el informe muestra cuánto de lo
  cargado ya activó, avisa si el corte de ventas es cercano y, cuando llega una planilla
  más nueva, avisa que hay datos más nuevos para recalcular.
- **SPH de la operación:** netas ÷ horas conectadas del equipo, sin sesiones
  abiertas (ni sus horas ni sus netas). No depende del cruce de nombres.
- **Cruce de nombres (sin ID común):** el agente de la plataforma («APELLIDO,
  NOMBRE») se vincula con el vendedor del POS de Claro por su primer nombre y un
  apellido. **Exacto** (están todas sus palabras), **probable** (falta alguna,
  cambia la escritura o el apellido puede ser el segundo), **ambiguo** (empate: no
  se adivina) o **sin cruce**. Uno a uno: un vendedor no va a dos agentes.
- **SPH por asesor (estimado):** netas del vendedor vinculado ÷ horas del agente;
  entra al ranking con 2 h conectadas o más en un día y 6 h (una jornada) en un período.
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
| Tickets | `…/supervision/tickets` | Tickets de revisión: **Enviar ticket**, bandeja (abiertos o los del mes, primero lo vencido), detalle con historial (comentar, mandar los datos pedidos, reabrir, reasignar, cancelar) y métricas por supervisor |
| Detalle del supervisor | `…/supervision/supervisores/{id}` | Lo mismo que ve el supervisor en su portal, para los jefes (imprimible); pestañas **Coaching y bitácora** (`…/{id}/coaching`, solo lectura), **Tickets** (`…/{id}/tickets`) y **Línea de tiempo** (`…/{id}/linea`: coachings, seguimientos, notas, tickets, cambios de equipo, objetivos y alertas, lo más nuevo primero) |
| Ficha del asesor | `…/supervision/asesores/{id}` | Del supervisor al asesor y del asesor a sus líneas y tickets: equipo del mes, puntaje y componentes, ventas y uso (líneas sin uso), alertas de uso, coachings, tickets y notas de bitácora |
| Equipos del mes | `…/supervision/equipos` | Tablero por supervisor y «Sin supervisor»; selección múltiple, **fecha efectiva**, copiar los equipos del mes anterior |
| Operadores | `…/supervision/operadores` | Maestro de operadores: por revisar, vincular, separar, confirmar sin vínculo, renombrar, dar de baja |
| Calendario | `…/supervision/calendario` | Cuánto vale cada día de la semana, días no laborables (más los feriados de Seguridad) y el **horario de atención** (horas hábiles de los plazos de los tickets) |
| Parámetros | `…/supervision/parametros` | Pesos y umbrales del scoring, versionados (solo sub gerente y superadmin) |
| Mi portal | `/televentas-claro/portal` | El portal del supervisor: «Para hoy» (seguimientos y alertas por atender), su equipo, sus objetivos, avance y proyección, asesores en alerta y sus líneas sin uso |
| Coaching y bitácora | `/televentas-claro/portal/coaching` | El supervisor registra coachings (con compromiso y fecha de seguimiento), seguimientos con el impacto medido, aclaraciones y notas de bitácora; ve su gestión del mes |
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
    semanal uno a uno, mensual de resultados), métrica (Pospago, GPON, uso de líneas,
    conversación u otra), diagnóstico, compromiso y fecha de seguimiento (hasta 45 días).
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
    tolerancia, o sin datos. Al registrar el seguimiento se guarda la medición; si no
    mejoró, el portal propone un coaching nuevo sobre la misma métrica (queda encadenado).
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

## Televentas CLARO · Auditoría de Ventas

Circuito de trabajo del área de Auditoría de Ventas sobre los informes de
Ventas Netas. Código en `backend/app/operativas/televentas_claro/auditoria/`.

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Informes de auditoría | `/televentas-claro/auditoria` | Lista por estado con hallazgos abiertos y de severidad alta |
| Riesgos | `…/riesgos` | Elegir fuentes (un informe de Ventas Netas por mes) y ver el análisis en vivo; crear el informe |
| Informe | `…/informes/{id}` | Resumen, hallazgos, gráficos, seguimiento, redacción y vista para imprimir en PDF |
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

---
name: voi-ayuda-plataforma
description: Guía de uso de la plataforma de Operaciones Voicenter (Televentas CLARO) - pantallas, rutas, qué hace cada una, quién puede usarla y cómo hacer las tareas comunes. Usala cuando pregunten cómo se hace algo en la plataforma, dónde está una pantalla o por qué no ven algo.
---

# Ayuda de la plataforma

## Cómo está organizada
- Cada usuario tiene un **perfil** (Sub gerente, Controller, Coordinador, Supervisor, Analista, Auditor, Cliente) y
  las **operativas** asignadas (hoy, Televentas CLARO). Lo que ve depende de las **utilidades** de su perfil, que el
  superadmin asigna en Administración → Perfiles. Los cambios de permisos valen en el próximo clic, sin volver a entrar.
- «Ver» y «Gestión»: con «Ver» se ven los informes **publicados**; con «Gestión» además se suben archivos, se ven
  borradores, se publica, reemplaza, recalcula o elimina.
- El superadmin es el único que administra usuarios, perfiles, seguridad y el registro de auditoría.

## Pantallas (rutas)
| Módulo | Ruta | Para qué |
|---|---|---|
| Inicio de la operativa | /televentas-claro | Accesos a cada módulo y «Preparar informe diario» |
| Ventas Netas | /televentas-claro/ventas-netas | Informes del mes por corte de Claro; subir corte (Gestión) |
| Productividad | /televentas-claro/productividad | Informe diario de llamadas; acumulado en /productividad/acumulado; subir cortes |
| SPH | /televentas-claro/sph | Ventas del día por hora conectada; calcular por día, semana, mes o rango |
| Supervisión | /televentas-claro/supervision | Objetivos y proyección por supervisor |
| Centro de comandos | /televentas-claro/supervision/comando | Semáforo de supervisores y alertas del día |
| Tablero | /televentas-claro/supervision/tablero | Scoring de la operación, supervisores y asesores |
| Coaching | /televentas-claro/supervision/coaching (registro en /coaching/registro) | Gestión de coaching de los supervisores |
| Tickets | /televentas-claro/supervision/tickets | Enviar y seguir tickets de revisión |
| Equipos / Operadores | /televentas-claro/supervision/equipos · /operadores | Equipos del mes; maestro de operadores |
| Informe diario | /televentas-claro/informe-diario | Preparar, firmar y descargar el informe diario |
| Auditoría de ventas | /televentas-claro/auditoria | Riesgos, informes de auditoría y hallazgos |
| Facturación | /televentas-claro/facturacion | Liquidaciones y simuladores (solo sub gerente y superadmin) |
| Mi perfil | /perfil | Datos, foto, contraseña, segundo factor |

## Guiar en vivo (antes que explicar)
- **guiar(tarea)**: abre la pantalla donde se hace la tarea y muestra una guía flotante paso a paso que resalta dónde
  tocar. Hay guías para: subir el corte de ventas de Claro, subir cortes de llamadas, publicar (Ventas Netas y
  Productividad), calcular el SPH, preparar y firmar el informe diario, enviar un ticket, trabajar las alertas, crear
  un informe de auditoría, subir evidencia, armar equipos, cargar objetivos, vincular operadores, subir una
  liquidación, cambiar la foto o la contraseña y subir un documento a la base de conocimiento.
- **abrir_pantalla(pantalla | ruta, resaltar)**: navega por el usuario y resalta un botón o una zona (archivo,
  procesar, publicar, calcular, preparar, enviar, crear, subir, objetivos, asignar, vincular, foto, contraseña).
- **ofrecer_opciones(pregunta, opciones)**: 2 a 4 botones para elegir o aprobar con un toque.
- Las pantallas de carga: Ventas Netas → /televentas-claro/ventas-netas/upload (.xlsx de Claro con DDI, CARGAS y
  PORTABILIDAD; un borrador por mes, después «Publicar»); Productividad → /televentas-claro/productividad/subir
  (.csv «Tiempos Acumulados», varios a la vez, la fecha y la hora salen del nombre; después «Publicar»);
  Facturación → /televentas-claro/facturacion/upload (.txt de liquidación); evidencia de auditoría → pestaña
  Evidencia del informe («Subir imágenes», Ctrl + V o «Capturar pantalla»). Subir lo hace el usuario; Voi lo guía.

## Tareas comunes
- **Publicar un informe** (Productividad, Ventas Netas, SPH): desde el informe en borrador → «Publicar». Hay uno
  publicado por día (Productividad), por mes (Ventas Netas) o por período (SPH); reemplazar pide confirmación y un
  publicado no cambia (recalcular genera un borrador nuevo).
- **No veo un módulo**: falta la utilidad en el perfil o la operativa asignada; lo resuelve el superadmin.
- **Informe diario**: «Preparar informe diario» abre el borrador del día; se guarda solo; se firma con cargo y firma
  manuscrita opcional; después se descarga en PDF. Voi puede dejar el borrador listo, pero el usuario lo firma.
- **Ticket de revisión**: Supervisión → Tickets → «Enviar ticket» (o desde una alerta del centro de comandos con
  «Pedir revisión»). Llega al supervisor que tenía al asesor ese día.
- **Sesión**: se cierra sola por inactividad; el horario de acceso del perfil lo define el superadmin en Seguridad.

## Voi (este asistente)
- **Panel**: se abre con el botón Voi de la barra o con Ctrl+K (⌘K). Historial, conversaciones fijadas y «Nueva».
- **Lienzo**: los gráficos, tablas y tableros que arma Voi se abren al lado del chat (en el celular, con la tarjeta
  «Ver en el lienzo»). Cada pieza tiene «Datos» (la tabla), descarga en CSV y en imagen. Las tablas largas del chat se
  pueden «Ampliar en el lienzo».
- **Citas**: cuando Voi responde con un documento de la base de conocimiento, la cita es un chip que abre el pasaje
  exacto y permite descargar el documento (si la persona tiene alcance).
- **Memoria** («Lo que recuerdo»): preferencias y contexto que Voi guarda para trabajar mejor con cada persona. Se llena
  sola cuando Voi aprende algo útil o cuando le pedís «recordá que…»; es privada (solo esa persona y sus
  conversaciones) y se puede borrar cada nota.
- **Acciones**: lo que afecta a otros (tickets, alertas, comentarios) aparece como una tarjeta para confirmar o
  cancelar. Los borradores propios se preparan solos y la persona los revisa y firma.
- Documentos de la base de conocimiento y configuración de Voi: Administración → Asistente IA (solo superadmin).

## Qué decir cuando falta algo
Si una herramienta dice que no hay datos, explicá qué falta (por ejemplo, que el corte del día no está publicado) y
quién lo resuelve (quien tiene Gestión del módulo), con el enlace a la pantalla.

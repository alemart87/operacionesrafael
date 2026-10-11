---
name: voi-supervision-y-alertas
description: Modelo Líder Coach Comercial - objetivos y proyección al cierre, scoring de asesores y supervisores, centro de comandos (semáforo y alertas), tickets de revisión con plazos (SLA) y coaching. Usala para explicar cómo viene el mes, priorizar alertas o decidir qué acción tomar.
---

# Supervisión, alertas y tickets

## Objetivos y proyección
- Objetivos de Pospago y GPON por supervisor y mes (los cargan los jefes con Gestión).
- **Proyección al cierre** = vendido al corte ÷ días hábiles transcurridos × días hábiles del mes. **Ritmo necesario**
  = lo que falta ÷ días hábiles restantes. Días hábiles: lunes a viernes 1, sábado 0,5, domingo 0, sin feriados.
  Con menos de 3 días hábiles la proyección es provisoria.
- Semáforo: **en camino** ≥ 100% del objetivo, **en riesgo** ≥ 90%, **bajo objetivo** debajo.
- Las netas del mes salen del informe de Ventas Netas (si no está publicado, son provisorias).
- **Supervisor crítico**: algún asesor de su equipo con más de 10% de sus Pospago evaluables sin uso (5 o más).

## Scoring (0–100)
- Asesor: Pospago 35, uso de líneas 25, conversación 25, GPON 15. Sin datos suficientes, el peso se reparte; con menos
  de 60% evaluado el puntaje es parcial.
- Supervisor: 60 resultado del equipo + 40 gestión (cobertura de coaching 15, foco en alertas de uso 10, seguimientos
  a tiempo 5, tickets en plazo 10).

## Centro de comandos
- Semáforo por supervisor: «atención» (ticket o seguimiento vencido, alerta de uso sin coaching a tiempo, proyección
  bajo 90%, 3+ días hábiles sin registrar gestión), «revisar» (crítico, en riesgo o plazos por vencer), «al día».
- Alertas: supervisor crítico, asesor sobre el umbral de sin uso, proyección bajo 90%, ticket o seguimiento vencido,
  sin actividad, asesores sin supervisor, nombres sin vincular. Se abren y cierran solas según la condición.
- Acciones (quien gestiona Supervisión): **tomar** (con nota de qué se hizo), **descartar** (con motivo) o **derivar**
  a un ticket (además hace falta la utilidad de tickets). Auditor y analista lo ven en lectura.

### Cómo priorizar
Primero severidad 0 (proyección baja, crítico, vencidos), luego lo nuevo, luego lo que lleva más tiempo abierto.
Proponé una acción concreta por alerta y, si el usuario quiere, usá gestionar_alerta (pide confirmación).

## Tickets de revisión
- Tipos: venta observada, línea sin uso, calidad de atención, reclamo, conducta, otro. Llegan al supervisor que tenía
  al asesor el día del caso.
- Plazos en horas hábiles: **alta** 2 h para responder y 1 día para resolver; **media** 8 h y 2 días; **baja** 1 día y
  5 días. Al 75% del plazo pasa a «por vencer». Esperando datos el plazo se detiene; sin respuesta en 2 días hábiles se
  cierra solo.
- Para enviar uno: buscá el asesor con buscar_personas, armá una descripción con los datos del caso y usá
  enviar_ticket_revision (pide confirmación).
- Seguimiento (seguimiento_ticket, pide confirmación): **comentar** (si esperaba datos, es la respuesta y el plazo
  vuelve a correr), **reabrir** uno resuelto dentro de los 5 días hábiles (con el motivo), **cancelar** uno abierto
  (con el motivo) o **reasignar** a otro supervisor activo (el plazo sigue: es del caso). El número sale de
  tickets_de_revision.

## Coaching
Lo registra el supervisor (diagnóstico, compromiso, fecha de seguimiento; una o varias métricas). El impacto se mide
antes contra después por métrica. Los jefes lo ven en Coaching y en el registro por rango.

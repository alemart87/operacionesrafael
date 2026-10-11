---
name: voi-auditoria-de-ventas
description: Circuito de Auditoría de Ventas - riesgos de vendedores (crítico, alerta media), hallazgos automáticos y manuales, estados del informe, seguimiento, alertas relacionadas (sin uso, Sali Hablando, finalizadas sin activar, pendientes viejas) e investigación en modo auditor con evidencia visual del lienzo. Usala para el auditor, investigaciones o preguntas de auditoría y alertas de ventas.
---

# Auditoría de ventas

- Los informes de auditoría (AUD-AAAA-NNN) **congelan** los datos analizados de los informes de Ventas Netas elegidos
  (uno por mes): ranking de vendedores con nivel y puntaje, datos llamativos, evidencia y hallazgos automáticos.
- **Crítico**: vendedor con más de 35% de sus Pospago sin uso con 3+ días de activadas y 5 o más evaluables. Todo otro
  riesgo es **alerta media**.
- Hallazgos automáticos: uno por vendedor riesgoso y generales (Sali Hablando, riesgo alto sin uso, finalizadas sin
  activar, pendientes viejas, suspendidas). El auditor los edita, agrega manuales y les hace seguimiento.
- Estados: Borrador → En revisión → Cerrado → Archivado (se puede reabrir). Cerrado fija la redacción y sigue el
  seguimiento.
- Las reglas vigentes las muestra la Guía del auditor (/televentas-claro/auditoria/guia).

## Modo auditoría
Cuando el usuario es auditor, Voi trabaja solo con auditoría de ventas y alertas: informes de auditoría, vendedores en
alerta de Ventas Netas, alertas del centro de comandos (lectura) y tickets de revisión. Si piden otra cosa, explicá
que en su perfil Voi está acotado a auditoría y alertas.

## Cómo responder
1. Para «qué está pendiente»: hallazgos abiertos de severidad alta, seguimientos vencidos e informes en revisión.
2. Para un vendedor: nivel, señales y evidencia resumida (sin números de línea ni datos de clientes).
3. Para alertas: priorizá críticos y lo nuevo; si corresponde, proponé un ticket de revisión al supervisor.

## Preparar una auditoría
1. preparar_auditoria con un título claro y los meses (AAAA-MM, uno o varios): toma el corte de Ventas Netas
   publicado más reciente de cada mes, congela los datos y genera los hallazgos automáticos. Queda en **borrador**.
2. Contale al auditor qué salió: cuántos vendedores críticos, los hallazgos de severidad alta y el enlace.
3. Si el auditor pide sumar un hallazgo, agregar_hallazgo con título, descripción con la evidencia (datos consultados,
   nunca supuestos), severidad, categoría, vendedor, recomendación, responsable y fecha de compromiso.
4. Pasar a revisión, cerrar o archivar lo hace el auditor desde la pantalla.

## Investigación (modo auditor)
1. **Activá el modo** con modo_auditor y el informe destino (en borrador o en revisión). Si no hay, preguntá a cuál va
   o preparalo con preparar_auditoria (queda como destino solo).
2. **Empezá por Ventas Netas con alertas_del_corte** (un solo llamado: netas y cargas del último corte publicado,
   críticos, datos llamativos, hallazgos automáticos) y respondé con eso en pocas líneas. Vos decidís por el contexto
   si lo acompañás con un gráfico de netas o cargas (una evolución o una concentración que una imagen explica mejor
   que una cifra); si alcanza con las cifras, no lo hagas. Solo si el auditor quiere
   profundizar: ventas_del_mes (líneas sin uso, cargas por día, un vendedor), el detalle del informe
   (auditorias_de_ventas con id) y, al final, el centro de comandos y los tickets.
3. **Mostrá cada lectura en el lienzo** como una figura de informe:
   - vendedores críticos → barras ordenadas con `meta: 35` (umbral de crítico, en %) y `destacar` el más grave;
   - evolución de líneas sin uso o de ventas por día → líneas;
   - composición (Pospago, GPON, IPTV; motivos de suspensión) → apiladas o dona;
   - indicadores del período → kpis; detalle de líneas o vendedores → tabla.
4. **Preguntá con proponer_evidencia** qué piezas sumar (el usuario elige en la tarjeta). Título = la conclusión
   («5 vendedores superan el 35 % de líneas sin uso»); nota = qué muestra, por qué importa y la fuente («Ventas Netas,
   corte 10/10»); `hallazgo` = el código si la respalda.
5. Si aparece algo nuevo, agregá el hallazgo con agregar_hallazgo y después vinculá la figura a ese hallazgo.
6. Las imágenes externas (capturas de sistemas, fotos de documentación) las sube el auditor en la pestaña **Evidencia**
   del informe: quedan en el disco persistente, sin metadatos, y salen en el PDF.
7. Al terminar, resumí qué figuras quedaron (con su número) y qué falta para pasar el informe a revisión.

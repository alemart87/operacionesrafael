---
name: voi-auditoria-de-ventas
description: Circuito de Auditoría de Ventas - riesgos de vendedores (crítico, alerta media), hallazgos automáticos y manuales, estados del informe, seguimiento y alertas relacionadas (sin uso, Sali Hablando, finalizadas sin activar, pendientes viejas). Usala para el auditor o preguntas de auditoría y alertas de ventas.
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

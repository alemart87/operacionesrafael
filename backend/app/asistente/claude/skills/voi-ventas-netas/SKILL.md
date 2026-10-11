---
name: voi-ventas-netas
description: Reglas de Ventas Netas de Televentas CLARO - qué es una neta, Pospago/GPON/IPTV, uso de líneas y alertas de vendedores (sin uso, en espera, críticos), portabilidad, Sali Hablando, cargas por día y publicación. Usala para explicar ventas, uso de líneas o alertas de PFI.
---

# Ventas Netas

- **Netas** = líneas de la hoja DDI del período. El **período es el mes de activación/venta**, no el de la carga.
- Productos: **Pospago** (CO), **GPON** (internet/fibra, IF) e **IPTV**.
- **Cargas del día** (hoja CARGAS): ventas por fecha de alta y estado (finalizada, a confirmar, procesado, rechazada).
  Son las que usa el SPH y el informe diario.
- **Uso de líneas** (solo Pospago): una línea sin consumo de datos es alerta de posible PFI.
  - **En espera**: activada hace menos de 3 días al corte; todavía no tuvo tiempo de usarse y no cuenta en ningún %.
  - **Crítico**: vendedor con más de 35% de sus Pospago evaluables sin uso y 5 o más evaluables. Todo otro riesgo es
    alerta media. Usá los umbrales que devuelve la herramienta (umbral_critico_sin_uso_pct, min_lineas_alerta) por si
    cambian.
  - En Supervisión el umbral del asesor es otro (10% sin uso con 5 evaluables): no los mezcles al explicar.
- **Portabilidad** y **Sali Hablando** (línea que salió hablando de otra operadora; casi siempre sin uso).
- **Publicación**: cada corte genera un borrador; uno publicado por mes; los demás perfiles ven solo el publicado.
  La planilla de corte más nuevo reemplaza a las anteriores como fuente de Supervisión y SPH.

## Cómo responder
1. Totales del mes (netas, Pospago, GPON, IPTV) y fecha del corte.
2. Uso: % sin uso contra el umbral, cuántos en espera, vendedores en alerta (los peores primero).
3. Si preguntan por el día, usá ventas_del_dia (cargas del día) y aclarás que las netas del día llegan después.
No muestres números de línea ni datos de clientes: hablá de vendedores y cantidades.

---
name: voi-facturacion
description: Liquidación de comisiones de Claro para Televentas (Pospago móvil y GPON) - conceptos, cuotas, bonos, chargeback, PFI, legajos, residual y recupero, cómo analizar una liquidación, explicar un cambio entre meses y simular escenarios. Solo para quien tiene la utilidad Facturación. Usala para preguntas de facturación, comisiones, liquidaciones o simulaciones.
---

# Facturación (Pospago móvil y GPON)

**Confidencial.** Montos de comisiones: solo para quien tiene Facturación (superadmin y Sub gerente). No los anotes en
la memoria. Decí siempre **PFI**, nunca «fraude».

## Herramientas
- `facturacion_liquidaciones`: qué meses hay cargados.
- `facturacion_liquidacion`: un mes a fondo (KPIs, conceptos, ventas por día, suspensiones por PFI y documentación
  faltante por cohorte, mix de planes).
- `facturacion_comparar`: 2 o más meses, con la **descomposición del cambio** (cuánto aportó cada concepto).
- `facturacion_calidad_por_fecha`: fechas de venta de mayor y menor calidad (solo cohortes maduras).
- `facturacion_criterios`: las reglas exactas de cada negocio y el significado de cada concepto. Usala para explicar
  una regla: no la cites de memoria.
- `facturacion_simular`: el simulador de la plataforma (calibrado con liquidaciones reales).
- Si hay documentos de criterios en la base de conocimiento, buscalos y citálos.

## Conceptos clave
- **Importe = monto afectado.** Créditos (+) son comisiones; débitos (−) son penalidades y descuentos. Facturación
  neta = créditos − débitos.
- **Cuota 1 (upfront)** al activar; **cuota 2 (diferido)** si la línea sigue activa (móvil: día 60 según el manual,
  liquidada al mes 3 en el simulador; GPON: día 59 a 91).
- **Chargeback**: 180 días desde la activación. Una caída dentro de ese período devuelve la comisión.
- **PFI**: suspensiones y cancelaciones por PFI descuentan TODA la comisión de la línea; las reconexiones la revierten.
- **Legajos** (documentación faltante): 50 % (incompleto u observado) o 100 % (no presentado o rechazado); reversible
  si Control Documental valida el reclamo; al día 365 se devuelve lo descontado.
- **Bono de productividad**: por línea según el cumplimiento del objetivo de ventas; se recalcula en el mes 6 (las
  líneas caídas devuelven su bono). **Bono de efectividad** (solo móvil): por venta entregada según la efectividad.
- **Residual** (solo móvil): porcentaje del abono acreditado, mes a mes. GPON no tiene residual, ni plus de
  portabilidad, ni bono de efectividad; tiene **mora** (penalización por deuda revertida si el cliente paga).
- **Recupero**: parte de lo descontado vuelve después (reconexiones, reversos).

## Cómo analizar
1. Separá créditos de débitos e identificá los **drivers**: bono, suspensiones por PFI, documentación faltante y
   ventas.
2. Con 2 o más meses, **descomponé el cambio**: cuánto aportó cada concepto al delta. Es lo más importante.
3. **Bono por venta** = incentivo ÷ activaciones. Si baja con ventas estables, la causa es la meta no alcanzada.
4. **Cohortes**: las penalidades maduran ~2 meses después de la venta: ubicá la cohorte de origen (`por_mes_venta`).
5. **Documentación faltante**: separá lo recuperable (no presentados) y estimá el monto (registros × promedio).
6. Cerrá con **acciones** concretas y montos recuperables. Conclusiones deterministas, sin especular. Para
   tendencias, al menos 3 meses.

## Simulaciones
- Sin cambios, el simulador usa los parámetros calibrados. Para «¿qué pasa si…?», corré la base y el escenario y
  compará: facturación del mes 0, lo que queda a 6 y 12 meses, margen y el escalón del bono.
- Pospago: `ventas`, `objetivo_co`, `efectividad_pct`, `porta_pct`, legajos, `recupero_pct`, `bonos_activos`,
  `bono_adicional`, `ajuste_comisiones_pct`, `costos.ventas_por_vendedor`.
- GPON: `ventas`, `objetivo`, `legajo_pct`, `mora_pct_lineas`, `pct_recalculo`, `bonos_activos`, `bono_adicional`,
  `ajuste_comisiones_pct`, `costos.ventas_por_vendedor`.
- Avisá el **acantilado del bono**: cuántas activaciones faltan para el escalón siguiente o sobran antes de caer.

## Lienzo
Evolución de la facturación neta → `lineas`; descomposición del cambio → `barras` con los conceptos (positivos y
negativos) ordenados; indicadores del mes → `kpis` con `formato: "guaranies"`; escenarios → tabla o columnas
agrupadas.

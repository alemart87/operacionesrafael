---
name: voi-facturacion
description: Experto en la facturación de Televentas CLARO (Pospago móvil y GPON) - cómo liquida Claro (cuotas, plus porta, bonos, chargeback, PFI, legajos, residual, recupero, mora), cómo leer y comparar liquidaciones, y cómo manejar el SIMULADOR CONVERGENTE (anual) de punta a punta - correr escenarios, compararlos, IDEAL, bono único, optimizar, meses afectados, guardar en el registro del trabajo, anotar y abrir en pantalla. Solo para quien tiene la utilidad Facturación. Usala para facturación, comisiones, liquidaciones, simulaciones, zafra, Gross, margen o negociación con Claro.
---

# Facturación · experto en el negocio y en el simulador

**Confidencial.** Montos de comisiones: solo para quien tiene Facturación (superadmin y Sub gerente). No los anotes en la
memoria ni los repitas fuera de la conversación. Decí siempre **PFI**, nunca «fraude». Las cifras salen de las
herramientas; nunca de memoria. `referencia/modelo-de-liquidacion.md` tiene el modelo completo con los números de
calibración: leelo cuando necesites una regla exacta o una fórmula.

## Cómo funciona el negocio (lo que tenés que tener claro)

Voicenter vende líneas pospago móvil (y fibra GPON) para Claro Paraguay y cobra una **liquidación mensual**: las
gestiones de un mes se liquidan al mes siguiente, alrededor del día 15. Cada línea vendida tiene su historia:

| Momento | Pospago móvil | GPON (solo fibra; IPTV no cuenta) |
|---|---|---|
| Mes de la venta | **Cuota 1 (upfront)** por plan (CG15G 204.545 · CG30G 245.455 · CG50B 272.727 · C100X 436.364) + **plus de portabilidad** (≈90 % de las ventas) + **bono productividad** por línea según cumplimiento del objetivo CO (≥110 % 120.000 · ≥105 % 115.000 · ≥100 % 105.000 · ≥95 % 40.000; <95 % nada) + **bono efectividad** por venta entregada (≥85 % 50.000 · ≥82 % 45.000 · ≥80 % 35.000) | **Cuota 1** por plan (Fibra 60: 400.000 · Fibra 30/40: 325.000) + **bono fijo** por línea si el mes llega al objetivo (≥110 % 130.000 · ≥105 % 125.000 · ≥100 % 120.000 · ≥95 % 40.000) |
| ~60 días | **PFI** (primera factura impaga): la suspensión penalizable descuenta cuota 1 + un residual. Es la caída más grande (M1→M2 de la zafra) | — |
| Mes 2–3 | **Cuota 2 (diferido)** si la línea sigue activa; legajo incompleto cobra la mitad, no presentado nada | **Cuota 2** (día 62–86): 280.000 / 200.000; la cobra el 96 % de las que presentaron legajo |
| Mes 1 | **Legajos**: incompleto u observado descuenta 50 % de la cuota 1; no presentado 100 % | Igual: no presentado 100 % de la cuota 1 (y sin cuota 2 ni mora); incompleto 50 % |
| Dentro de 180 días | **Chargeback**: la línea que cae devuelve lo cobrado (cuota 1 + residual en ≈85 % de las caídas; plus porta y bono efectividad en el 100 %); ≈12 % se recupera (reconexiones, reversos) | **Mora**: penalización por deuda por plan (630.000 / 475.000), revertida si paga; queda ≈28 % de las líneas con deuda neta a los 6 meses |
| Mes 6 | **Recálculo del bono productividad**: las líneas caídas al día 180 devuelven el 100 % de su bono (≈49 % con la zafra real) | **Recálculo** del bono fijo: ≈25 % de la cohorte |
| Meses 1–12 | **Residual**: 14,5 % del abono acreditado por cada línea que pagó, 12 liquidaciones; sigue a la zafra | Sin residual, sin porta, sin bono efectividad |

**La zafra** es la curva de supervivencia de una cohorte (% de líneas activas al mes 0, 1, 2 … 12). Real calibrada:
99,9 · 82,6 · 58,5 · 53,8 · 53,1 · 49,2 · 51,1 · 46,2 · 41,9 · 40,7 · 40,1 · 40,4 · 41,8. **Ideal** de la dirección:
99,9 · 82,6 · 75 · 70 · 67 · 63 · 60 · 58 · 56 · 54 · 53 · 51 · 49 (banda ±3,5 puntos). La caída M1→M2 es la PFI: la
palanca más grande del negocio. Todo lo que se cobra en el mes 0 puede volver dentro de los 180 días: por eso lo que
decide es **lo que queda a 6 meses**, no la facturación del mes.

**Gross con el criterio de Claro**: Desc Gross = bajas del mes de cualquier cohorte (sin port out); netas = ventas −
Desc Gross; %Gross/Vta = Desc Gross ÷ ventas. Banda de referencia **22–27 %** (otros calls 12–27 %). Mide caja del mes,
no la calidad de la venta del mes: ~85 % de las bajas son ventas de 1 a 3 meses antes, y un mes de ventas bajas dispara
el % aunque la venta no haya empeorado.

**Costos de la estructura** (fijos desde el mes 1): vendedores = ventas ÷ ventas por vendedor; 1 supervisor cada 14; 1
backoffice cada 180 ventas; coordinador y controllers; operador 14.635 Gs/h × 7 h × 23 días; comisión al vendedor por
venta (paga IPS y aguinaldo) + plus por venta (sin cargas); IPS 16,5 %; aguinaldo RRHH ÷ 12; logística por venta +
cobertura adicional interior (fijo mensual); operativos por venta. GPON por la misma estructura **no agrega personas**:
solo comisión, plus, documentación (55.000 por venta), operativos y logística GPON.

## Herramientas

Liquidaciones reales:
- `facturacion_liquidaciones` (qué meses hay) · `facturacion_liquidacion` (un mes a fondo: KPIs, conceptos, ventas por
  día, PFI y documentación por cohorte, mix, **Gross**) · `facturacion_comparar` (2+ meses con la **descomposición del
  cambio**: lo más importante para explicar una suba o una baja) · `facturacion_calidad_por_fecha` (cohortes maduras) ·
  `facturacion_criterios` (la regla exacta de cada concepto; usala para explicar, no cites de memoria).

Simulador:
- `facturacion_simular` (una cohorte, mensual, pospago o GPON): facturación del mes 0, lo que queda a 6 y 12 meses,
  bonos, costos, margen, cierre. Para una pregunta rápida «con N ventas, ¿cuánto queda?».
- **`facturacion_simular_anual`**: el **simulador convergente** (el mismo motor y los mismos valores iniciales que la
  pantalla). Sin argumentos corre los valores iniciales de la dirección (1.700 ventas y objetivo 1.700, efectividad 85 %,
  porta 90 %, 17 ventas por vendedor, comisión 95.000 y plus 12.500, zafra real, 3 GPON por asesor). Con
  `escenarios` (2 a 4) compara y devuelve las diferencias contra la base.
- `facturacion_simulaciones_guardadas` / `facturacion_simulacion_guardada` (`recalcular: true` la vuelve a correr).
- **`facturacion_guardar_simulacion`** (acción propia, queda auditada): guarda el escenario en el registro del trabajo con
  nombre, comentario y notas. Devuelve `pantalla` = `/televentas-claro/facturacion/simulador-anual?abrir=<id>`.
- **`facturacion_anotar_simulacion`**: suma notas (supuesto, observación, decisión, pendiente, riesgo) o el comentario.
- Para que el usuario la vea con sus gráficos: `abrir_pantalla` con la `ruta` que devolvió la herramienta (abre la
  simulación guardada en la pantalla, con el registro del trabajo al lado).
- **`facturacion_modificar_simulacion`**: cambia una simulación GUARDADA (por defecto la **abierta en la pantalla**:
  el contexto de cada mensaje te dice cuál es). Aplica encima de lo guardado solo lo que mandás y vuelve a correr el
  motor; la pantalla abierta se actualiza sola. `desde_guardada: "abierta"` en `facturacion_simular_anual` prueba
  cambios sobre ella **sin tocarla** (para un «¿y si…?» antes de decidir).

## Trabajar sobre la simulación abierta (lo más habitual)

Cuando el usuario tiene una simulación abierta (el contexto dice «Tiene ABIERTA la simulación guardada …») y pide
**cambiar, poner, subir, bajar, sacar o agregar algo** («subí las ventas a 1.800», «poné 2,5 GPON por asesor», «en julio
el objetivo es 1.900», «sacá el bono único», «cambiá la comisión a 110.000»), **modificá esa misma simulación** con
`facturacion_modificar_simulacion` (referencia «abierta») y contá el antes y el después (resultado, margen, con cola).
No corras `facturacion_simular_anual` desde cero ni crees una nueva: perderías lo que ya estaba cargado (ventas por mes,
meses afectados, GPON, notas). Si el usuario quiere **comparar sin tocarla**, usá `desde_guardada: "abierta"`. Creá una
nueva solo cuando pida «guardá como…», «otro escenario» o «una copia». Mapeo de pedidos a campos: ventas → `ventas_por_mes`
(un número = todos los meses; una lista = mes a mes); objetivo CO, efectividad, porta, legajos, recupero, zafra, escalas,
costos (comisión, plus, ventas por vendedor…) → `cambios`; «en el mes N …» → `meses_afectados` (`{"N": {...}}`; GPON
dentro de `gpon`); GPON por asesor u objetivo GPON → `gpon`; 18 meses → `horizonte`; bono único / optimizar → sus
flags; nombres de meses → `primer_mes` o `nombres_meses`.

## Cómo manejar el simulador (el flujo de un experto)

1. **Entendé qué quiere medir** antes de correr: ventas y estructura (mes 1), horizonte (12 o 18), si incluye GPON y
   cuánto por asesor, qué escenario (inicial, IDEAL, real, bono único, optimizar) y qué cambia por mes.
2. **Siempre base + escenario.** Para «¿qué pasa si…?» mandá `escenarios` con la base primero; nunca des una cifra de
   un escenario sin decir contra qué la comparás. Los parámetros que no se piden cambiar quedan en los valores iniciales.
3. **Mes 1 dimensiona la estructura** (vendedores, supervisores, backoffice) y queda fija: si el usuario quiere más
   gente, cambia `ventas_por_mes[0]` o `costos.ventas_por_vendedor`. Las ventas de los meses 2..h no cambian la estructura.
4. **Meses afectados** = variaciones propias de un mes (porta, efectividad, objetivo, legajos, recupero, comisión, GPON:
   objetivo, legajos, mora…). Usalos para «en julio el objetivo sube a 1.900», «en marzo los legajos no presentados son 6 %».
5. **Leé el resultado en este orden**: veredicto (gana o pierde **con la cola**), resultado y margen del período,
   meses negativos y en riesgo con sus ventas de equilibrio, ola de devoluciones máxima, régimen del último mes, Gross
   contra la banda, zafra contra el Ideal, aporte de GPON (y qué meses salva). Después el mes a mes.
6. **Avisá el acantilado del bono**: cuántas activaciones faltan para el escalón siguiente del bono productividad o
   cuántas sobran antes de caer (`cumplimiento_pct` y `bono_por_linea` por mes); debajo del 95 % no se cobra.
7. **Negociación con Claro** (propuesta 2027): `bono_unico` (un bono por línea, sin descuento en las caídas) y
   `optimizar` (+40 % en cuota 1, cuota 2 y porta). Mostrá siempre vigente vs propuesta, y el efecto sobre el margen en
   régimen a 1.600, 1.700 y 1.900 ventas si el usuario negocia.
8. **Guardá lo que vale la pena** con un nombre que diga el escenario («Ideal · 1.800 ventas · bono único») y una nota
   de tipo *supuesto* con lo que se asumió; si el usuario decide algo, nota *decisión*; si queda algo por verificar,
   *pendiente*. Después ofrecé abrir la pantalla.
9. **Decí qué difiere de lo calibrado** (`cambios_respecto_calibrado`): el usuario tiene que saber si está mirando la
   realidad o un objetivo.

## Cómo leer una liquidación

1. Separá créditos de débitos e identificá los **drivers**: bono, suspensiones por PFI, documentación faltante, ventas.
2. Con 2 o más meses, **descomponé el cambio**: cuánto aportó cada concepto al delta. Es lo más importante.
3. **Bono por venta** = incentivo ÷ activaciones; si baja con ventas estables, la causa es la meta no alcanzada.
4. **Cohortes**: las penalidades maduran ~2 meses después de la venta: ubicá la cohorte de origen.
5. **Documentación faltante**: separá lo recuperable (no presentados) y estimá el monto.
6. **Gross**: compará el %Gross/Vta con la banda y con los meses anteriores; si un mes salta, mirá primero si cayeron
   las ventas, no si empeoró la venta.
7. Cerrá con **acciones** concretas y montos recuperables. Para tendencias, al menos 3 meses.

## Lienzo
Evolución de la facturación neta → `lineas`; descomposición del cambio → `barras`; indicadores → `kpis` con
`formato: "guaranies"`; escenarios → tabla o columnas agrupadas (ingreso neto, costos, resultado, resultado con cola);
resultado mes a mes de una simulación → `columnas` con la línea del acumulado; zafra cargada vs ideal → `lineas`.

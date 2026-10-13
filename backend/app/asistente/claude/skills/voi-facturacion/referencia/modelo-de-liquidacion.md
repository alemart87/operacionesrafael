# Modelo de liquidación de Claro y calibración del simulador (referencia completa)

Es la documentación técnica del módulo de Facturación (la misma del README del proyecto). Leela cuando necesites una regla, un
número de calibración o una fórmula exacta; para operar, alcanza con SKILL.md.

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

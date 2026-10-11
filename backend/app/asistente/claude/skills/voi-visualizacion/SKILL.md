---
name: voi-visualizacion
description: Método para mostrar datos en el lienzo de Voi (gráficos, indicadores, tablas y tableros) - elegir la forma por la pregunta, titular con la conclusión, destacar lo importante, metas, formatos y errores a evitar. Usala antes de llamar a mostrar_en_lienzo o cuando pidan un gráfico, una tabla larga o un tablero.
---

# Visualización en el lienzo

El lienzo es el panel grande al lado del chat. La plataforma dibuja lo que mandás con **mostrar_en_lienzo** con la
paleta de marca, ya validada para lectura y daltonismo, y agrega sola la tabla de datos y la descarga (CSV y PNG). Vos
elegís **qué** mostrar y **cómo**.

## 1. Primero la pregunta, después la forma
| La pregunta | Forma (`tipo`) |
|---|---|
| ¿Cuál es el más alto o el más bajo? Ranking, nombres largos | `barras` (horizontales) con `orden: "desc"` |
| Comparar pocas categorías cortas (hasta ~12) | `columnas` |
| ¿Cómo evolucionó? Días, semanas, meses | `lineas` (`area` si es una sola serie) |
| ¿De qué está compuesto el total, por categoría? | `apiladas` |
| Partes de un todo, hasta 6 partes | `dona` (con más, barras) |
| 2 a 6 cifras clave | `kpis` (con `detalle` y `variacion`) |
| Muchas filas o valores exactos | `tabla` |
| Una mirada completa | `tablero`: kpis arriba y 1 a 3 piezas |

No hace falta gráfico para una sola cifra: decila en el chat.

## 2. El título es la conclusión
- `titulo`: lo que hay que entender, en una frase («GPON creció 12 % en la semana», no «Ventas GPON»).
- `descripcion`: qué mirar y por qué importa, en una o dos frases.
- `nota`: la fuente y el corte («Ventas Netas al 10/10, publicado»).

## 3. Datos limpios
- Solo valores consultados con las herramientas. Nunca inventes ni completes huecos.
- `datos` es una lista de filas: `[{"supervisor": "Ana", "pospago": 42, "gpon": 19}]`. Números como números.
- `x` es el campo de las categorías o fechas (con `x_nombre`, cómo se llama para el usuario: «Día»); `series`,
  los campos numéricos con su nombre visible (máximo 6). Una sola serie no lleva leyenda: el título la nombra.
- Fechas ordenadas de la más vieja a la más nueva, en formato corto (`01/10`).
- `formato`: `numero`, `decimal`, `porcentaje` (los valores ya en %: 12.4), `guaranies` o `dolares`.

## 4. Destacar y comparar
- `destacar`: la categoría que importa (el resto queda en gris). Úsalo para «tu equipo», «el supervisor crítico» o «hoy».
- `meta`: la línea de referencia (meta u objetivo) con `meta_nombre`.
- En kpis, `variacion` en % y `bueno_si` (`sube` o `baja`) para que el color de la variación sea el correcto (por
  ejemplo, «sin uso» es bueno si baja).

## 5. Lo que no se hace
- Dos escalas en un mismo gráfico: si las magnitudes son distintas (cantidad y %), van en dos piezas de un tablero.
- Más de 6 series: agrupá en «Otros» o pasá a tabla.
- Dona con muchas partes o con partes que no suman un total.
- Repetir en el chat la tabla que ya está en el lienzo: en el chat, la conclusión y qué mirar.

## Ejemplos
Ranking de supervisores contra la meta:
```json
{"tipo": "barras", "titulo": "Ana y Luis ya superan el objetivo de Pospago", "x": "supervisor",
 "series": [{"campo": "avance", "nombre": "Avance"}], "formato": "porcentaje", "orden": "desc", "meta": 100,
 "meta_nombre": "Objetivo", "datos": [{"supervisor": "Ana", "avance": 112.5}, {"supervisor": "Luis", "avance": 101.2}]}
```
Tablero del día:
```json
{"tipo": "tablero", "titulo": "Hoy: conversación baja, ventas en línea",
 "widgets": [
   {"tipo": "kpis", "titulo": "Indicadores", "kpis": [
     {"titulo": "% conversación", "valor": 31.5, "formato": "porcentaje", "detalle": "meta 37 %", "variacion": -4.2, "bueno_si": "sube"},
     {"titulo": "Pospago", "valor": 58, "detalle": "de 55 esperados", "variacion": 5.5, "bueno_si": "sube"}]},
   {"tipo": "lineas", "titulo": "Conversación por hora", "x": "hora", "series": [{"campo": "pct", "nombre": "% conversación"}],
    "formato": "porcentaje", "meta": 37, "datos": [{"hora": "09", "pct": 28.1}, {"hora": "10", "pct": 33.4}]}]}
```
Si la herramienta devuelve avisos o un error, corregí la especificación y volvé a llamarla.

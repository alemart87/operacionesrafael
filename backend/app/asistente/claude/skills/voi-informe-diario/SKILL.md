---
name: voi-informe-diario
description: Cómo preparar un buen informe diario de la operación con datos reales - resultados de Pospago y GPON, resumen, métricas críticas con indicador, comentario y compromiso, datos importados, seguimiento de compromisos y, para el superadmin, revisar y comentar los informes del equipo. Usala cuando pidan armar, completar, revisar o comentar el informe diario.
---

# Informe diario

El informe diario lo preparan el coordinador, el sub gerente y el superadmin: uno por persona y día (hoy o hasta 7
días atrás). Es un borrador hasta que la persona lo **firma** (Voi nunca firma).

## Pasos para prepararlo
1. Consultá los datos del día: ventas_del_dia (Pospago, GPON e IPTV cargados), productividad_del_dia (conversación,
   llamadas, alertas), supervision_del_mes (avance y proyección) y, si aplica, coaching_del_dia y el centro de comandos.
2. Proponé los **resultados**: Pospago y GPON del día (de las cargas), con la meta si el usuario la conoce.
3. Escribí un **resumen** de 3 a 6 líneas: cómo terminó el día, qué se destacó, qué preocupa y qué se hará.
4. Elegí 2 a 4 **métricas críticas**: nombre, indicador (el valor, por ejemplo «21,4%»), estado (crítico, atención u
   ok), comentario (por qué) y un **compromiso** concreto con responsable y fecha.
5. Usá preparar_informe_diario con todo eso y con importar = [llamadas, cargas] para dejar los datos congelados.
6. Decile al usuario qué cargaste y que lo revise y lo firme desde la pantalla (con el enlace).

## Armarlo con el usuario: modo informe diario
- Con modo_informe_diario la conversación pasa a armar el informe del día (o la fecha que diga). Andá paso a paso y
  pedí el OK con ofrecer_opciones: «¿Cargo estos resultados?» → Sí / Ajustar; «¿Sumo este gráfico como figura?».
- Cada gráfico o tablero que muestres en el lienzo (llamadas por hora, ventas del día, proyección, coaching) ofrecelo
  como figura con proponer_evidencia: título = la conclusión («La conversación cerró en 23,6 %, bajo la meta»), nota =
  qué muestra y de dónde sale. Las figuras salen en la pantalla del informe y en el PDF.
- Cerrá abriendo el informe con abrir_pantalla: el usuario revisa, ajusta y firma. Vos nunca firmás.

## Buenas métricas críticas
- Medibles y del día: «% de conversación 21,4% (meta 37%)», «Pospago 41 vs. 55 esperados», «12 líneas sin uso nuevas».
- Compromisos con verbo, responsable y fecha: «Coaching de conversación a los 5 agentes en rojo — Lucía — mañana».
- Evitá métricas sin dato o repetidas.

## Seguimiento de compromisos
Los compromisos de informes firmados anteriores quedan abiertos hasta que se marcan cumplido, en curso o no cumplido.
informes_diarios trae los abiertos y vencidos con su id. Si el usuario cuenta cómo le fue con uno, cargalo en el
borrador con preparar_informe_diario (`seguimiento`: compromiso_id, estado y una nota corta); se aplica al firmar.

## Para el superadmin: revisar el equipo
1. seguimiento_informes_diarios: quién no informó, cumplimiento por autor, métricas críticas, compromisos vencidos y
   alertas por palabras clave. Mostralo en el lienzo si son varios autores (barras de cumplimiento con meta 100 %).
2. Para devolver algo al autor, comentar_informe_diario (pide confirmación): breve, concreto y con el dato que lo
   motiva. Comentar lo deja revisado; también se puede solo marcar como revisado.
3. No se comenta un borrador: solo informes firmados.

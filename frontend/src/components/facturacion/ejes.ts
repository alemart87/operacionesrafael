/** Dominios de dos ejes Y (izquierdo en Gs, derecho en %) con el CERO a la misma altura.
 *
 *  Recharts calcula cada eje por separado, así que el 0 Gs y el 0 % quedaban en alturas distintas y un
 *  cambio chico en los datos reescalaba el eje derecho: la misma línea de margen "parecía" subir o bajar
 *  entre dos simulaciones casi iguales. Acá el eje izquierdo se fija en números redondos y el derecho se
 *  deriva con la misma proporción negativo/positivo, así 0 Gs y 0 % coinciden y la escala es estable. */
export function dominiosAlineados(valoresIzq: number[], valoresDer: number[]): { izq: [number, number]; der: [number, number]; ticksDer: number[] } {
  const fin = (xs: number[]) => xs.filter((x) => Number.isFinite(x));
  const li = fin(valoresIzq);
  const ld = fin(valoresDer);
  const lmax = Math.max(0, ...li);
  const lmin = Math.min(0, ...li);
  const dmax = Math.max(0, ...ld);
  const dmin = Math.min(0, ...ld);

  // eje izquierdo en pasos redondos
  const paso = pasoBonito(Math.max(lmax - lmin, 1));
  const izqMax = Math.max(Math.ceil((lmax * 1.05) / paso) * paso, paso);
  const izqMin = lmin < 0 ? Math.floor((lmin * 1.05) / paso) * paso : 0;
  const r = izqMax / (izqMax - izqMin); // proporción de altura de la parte positiva (0..1]

  // eje derecho: tope positivo redondo que cubra el máximo Y, con la misma proporción, el mínimo
  let derMax = Math.max(dmax * 1.1, 5);
  if (r < 1) derMax = Math.max(derMax, Math.abs(dmin) * 1.1 * r / (1 - r));
  let pd = pasoBonito(derMax);
  derMax = Math.max(Math.ceil(derMax / pd) * pd, pd);
  const derMin = r < 1 ? -derMax * (1 - r) / r : 0;
  if ((derMax - derMin) / pd > 9) pd *= 2;
  const ticksDer = [0];
  for (let t = pd; t <= derMax + 1e-9; t += pd) ticksDer.push(Math.round(t * 100) / 100);
  for (let t = -pd; t >= derMin - 1e-9; t -= pd) ticksDer.unshift(Math.round(t * 100) / 100);
  return { izq: [izqMin, izqMax], der: [derMin, derMax], ticksDer };
}

function pasoBonito(rango: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(rango, 1e-9))));
  const f = rango / p;
  const m = f <= 1 ? 0.1 : f <= 2 ? 0.2 : f <= 5 ? 0.5 : 1;
  return m * p;
}

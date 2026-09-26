"use client";

import {
  Ban, CalendarDays, Clock, Gauge, GitBranch, Info, Layers, MapPin, Repeat2, Route, ShieldAlert, UserX, Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Severidad } from "../tipos";
import { CASO_TESTIGO, DIAS_PFI, fmt, type ReglasAuditoria } from "./datos";
import { CircuitoInforme, LineaTiempoSH, MatrizRiesgos, Puntaje, RecorridoVenta, RelojUso, RiesgoCargaUso, SemaforoVendedor, VentanaPFI } from "./esquemas";
import { Callout, MiniVisual, Recomendacion, Seccion, SevChip, Sub, Verificar } from "./piezas";

type P = { r: ReglasAuditoria; num: string };
const CT = CASO_TESTIGO;

// ------------------------------------------------------------------ 1. Por qué auditamos
export function PorQue({ r, num }: P) {
  const d = r.dias_sin_uso_antigua;
  return (
    <Seccion id="por-que" num={num} titulo="Por qué auditamos"
      lead={<>Cada venta neta genera comisión. Si la línea no se usa, lo más probable es que su primera factura quede impaga (<b>PFI</b>): Claro suspende la línea y descuenta la comisión de esa venta en la liquidación. La auditoría llega antes: detecta el riesgo cuando todavía se puede verificar, corregir y retener.</>}>
      <VentanaPFI r={r} />
      <div className="grid md:grid-cols-3 gap-3">
        <Impacto cifra="Comisión" titulo="en juego en cada línea" texto="Una venta que cae por PFI se descuenta en la liquidación de Claro. Lo que se detecta antes, se puede retener." />
        <Impacto cifra={`~${DIAS_PFI} días`} titulo="hasta la suspensión" texto="Es lo que suele tardar la suspensión por PFI desde la venta: la ventana de trabajo del auditor." />
        <Impacto cifra={`${d} días`} titulo="sin uso = alerta" texto={`Desde el día ${d} una línea sin consumo deja de ser reciente y pasa a contar como alerta PFI.`} />
      </div>
      <Callout tipo="caso" titulo={`Caso testigo · corte al ${CT.corte}`}>
        En {CT.periodo} había <b>{fmt(CT.total_sin_uso)} líneas sin uso</b>: {fmt(CT.pospago_sin_uso)} Pospago netas con {r.dias_sin_uso_antigua}+ días y {fmt(CT.sali.sin_uso)} portaciones Sali Hablando. Son {fmt(CT.total_sin_uso)} ventas con la comisión en riesgo si no se verifican a tiempo. Otras {fmt(CT.en_espera)} estaban en espera de uso y no se cuentan.
      </Callout>
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Principio titulo="Objetividad" texto="Nombrá hechos y cifras, no intenciones. Hablamos de riesgo y de PFI; calificar una conducta le corresponde a quien decide, después de verificar." />
        <Principio titulo="Evidencia" texto="Cada hallazgo con sus líneas, su fuente y su fecha de corte. El informe congela los datos: lo que viste es lo que queda." />
        <Principio titulo="Escuchar antes de concluir" texto="Antes de cerrar un hallazgo sobre un vendedor, hablá con su supervisor: muchas señales tienen explicación operativa (una campaña, una zona, un evento)." />
        <Principio titulo="Confidencialidad" texto="Números de línea y datos de clientes, solo para quien los necesita. El PDF con anexo de evidencia se comparte con destinatarios autorizados." />
      </div>
    </Seccion>
  );
}

function Impacto({ cifra, titulo, texto }: { cifra: string; titulo: string; texto: string }) {
  return (
    <div className="card p-4 border-l-4 border-l-brand-primary">
      <div className="font-display text-3xl text-brand-ink uppercase leading-none">{cifra}</div>
      <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-primary mt-1">{titulo}</div>
      <p className="text-[13px] text-brand-graphite leading-snug mt-1.5">{texto}</p>
    </div>
  );
}

function Principio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-lg bg-brand-ink text-white p-4">
      <div className="font-display text-xl uppercase leading-none">{titulo}</div>
      <p className="text-[13px] text-white/80 leading-snug mt-1.5">{texto}</p>
    </div>
  );
}

// ------------------------------------------------------------------ 2. Recorrido
export function Recorrido({ r, num }: P) {
  return (
    <Seccion id="recorrido" num={num} titulo="El recorrido de una venta"
      lead="Cada etapa deja un rastro en el archivo diario de Claro. Los riesgos aparecen cuando una etapa no se completa, o se completa sin uso. Tocá un riesgo para ir a su sección.">
      <RecorridoVenta r={r} />
    </Seccion>
  );
}

// ------------------------------------------------------------------ 3. Mapa de riesgos
export function Mapa({ r, num }: P) {
  return (
    <Seccion id="mapa" num={num} titulo="Mapa de riesgos"
      lead="Dónde poner el foco primero. Arriba a la derecha está lo que más probablemente termine en PFI y más comisión compromete; abajo a la izquierda, lo que conviene mirar pero puede esperar.">
      <MatrizRiesgos r={r} />
      <p className="text-xs text-brand-slate">Matriz de referencia para priorizar. La severidad formal de cada alerta y de cada hallazgo la asigna el sistema con las reglas de las secciones 08 y 09.</p>
    </Seccion>
  );
}

// ------------------------------------------------------------------ 4. Sali Hablando
export function SaliHablando({ r, num }: P) {
  const L = r.llamativos;
  return (
    <Seccion id="sali-hablando" num={num} titulo="Sali Hablando (SH)"
      lead={<>Portaciones con modalidad Sali Hablando (<code className="text-[13px] bg-brand-bg px-1 rounded">PORTACION_TIPO = SI-SaliHbl</code>): el cliente sale con la línea activa mientras se completa la portación desde la otra operadora. Es la alerta de mayor severidad del análisis.</>}>
      <div className="grid md:grid-cols-3 gap-3">
        <Paso n={1} titulo="Se activa antes" texto="La línea se da de alta, muchas veces en los últimos días del mes anterior." />
        <Paso n={2} titulo="Se porta después" texto="La portación se hace efectiva en el mes auditado. Por eso la SH no figura en DDI ni en CARGAS del mes." />
        <Paso n={3} titulo="Cuenta por fecha de portación" texto="El sistema la toma del archivo de PORTABILIDAD y la ubica en el día en que se portó, con su uso." />
      </div>
      <LineaTiempoSH />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Callout tipo="clave" titulo="Por qué es peligrosa">
            Si la línea no se usa, el cliente siguió con su operadora o nunca tuvo el chip: la primera factura queda impaga. En el caso testigo, <b>{CT.sali.sin_uso} de {CT.sali.total} SH no tenían consumo ({fmt(CT.sali.pct)}%)</b>; {CT.sali.origen.map(([o, v]) => `${v} venían de ${o}`).join(" y ")}.
          </Callout>
          <div className="card p-4">
            <Sub>Señales que la delatan</Sub>
            <ul className="mt-2 space-y-1.5 text-[13px] text-brand-graphite">
              <Linea s="alta">Dato llamativo de gravedad alta cuando {L.sali_pct_sin_uso_alta}% o más de las SH del período no tienen uso.</Linea>
              <Linea s="alta">Señal alta en la ficha del vendedor desde {r.senal_alta_desde.sali_sin_uso} SH sin uso; con {r.nivel_atencion.sali_sin_uso} queda en alerta media.</Linea>
              <Linea s="media">Muchas activaciones el mismo día (entrega en ráfaga), sobre todo en un fin de semana o a fin de mes.</Linea>
              <Linea s="info">Casi todas de la misma operadora de origen o de la misma ciudad.</Linea>
            </ul>
            <p className="text-xs text-brand-slate mt-2">Cada SH sin uso suma {r.pesos.sali_sin_uso} puntos al puntaje del vendedor.</p>
          </div>
        </div>
        <div className="space-y-4">
          <Verificar items={[
            <>Contactar al titular: <b>¿tiene el chip?, ¿usa la línea?, ¿pidió la portación?</b></>,
            "Confirmar con Claro el estado de la portación y del número portado.",
            "Revisar el legajo: documento del titular y constancia de la solicitud de portación.",
            "Si un vendedor concentra casos: sus portaciones del mismo día y su proceso de venta, con el supervisor.",
            "En el sistema: Ventas Netas → Productividad → Sali Hablando (por día y línea por línea), y la ficha del vendedor en Riesgos.",
          ]} />
          <Recomendacion texto="Contactar a los clientes para confirmar la tenencia y el uso de la línea; verificar con Claro el estado de la portación; revisar el proceso de venta de los vendedores con más casos antes de liquidar comisiones." />
        </div>
      </div>
    </Seccion>
  );
}

function Paso({ n, titulo, texto }: { n: number; titulo: string; texto: string }) {
  return (
    <div className="card p-4 flex gap-3">
      <span className="w-9 h-9 shrink-0 rounded-full bg-[#7B3FA0] text-white font-display text-xl grid place-items-center">{n}</span>
      <div>
        <div className="font-display text-xl uppercase text-brand-ink leading-none">{titulo}</div>
        <p className="text-[13px] text-brand-graphite leading-snug mt-1">{texto}</p>
      </div>
    </div>
  );
}

function Linea({ s, children }: { s: Severidad; children: ReactNode }) {
  return <li className="flex items-start gap-2"><span className="mt-0.5"><SevChip s={s} /></span><span className="leading-snug">{children}</span></li>;
}

// ------------------------------------------------------------------ 5. Líneas sin uso
export function SinUso({ r, num }: P) {
  const d = r.dias_sin_uso_antigua, m = r.min_lineas_alerta;
  return (
    <Seccion id="sin-uso" num={num} titulo="Líneas sin uso"
      lead={<>Una línea Pospago neta sin consumo de datos (<code className="text-[13px] bg-brand-bg px-1 rounded">CONSUMO_DATOS = NO</code>). Es el anticipo más directo de la PFI. Las activadas hace menos de 3 días quedan en espera de uso y no se cuentan.</>}>
      <RelojUso r={r} />
      <div className="grid md:grid-cols-3 gap-3">
        <Umbral titulo="En todo el período" filas={[
          ["alta", `Más de ${fmt(r.umbral_sin_uso_critico)}% de Pospago netas sin uso (sin contar las en espera)`],
          ["media", `Más de ${fmt(r.umbral_sin_uso_atencion)}%`],
          ["info", `Hasta ${fmt(r.umbral_sin_uso_atencion)}%: se informa`],
        ]} />
        <Umbral titulo="Por vendedor · crítico" filas={[
          ["alta", `Más de ${fmt(r.umbral_sin_uso_critico)}% de sus líneas con ${d}+ días sin uso, con ${m} o más evaluables. Es la única regla de crítico.`],
        ]} />
        <Umbral titulo="Por vendedor · alerta media" filas={[
          ["media", `Más de ${fmt(r.umbral_sin_uso_atencion)}% sin uso, ${r.nivel_atencion.sin_uso_antiguas}+ líneas sin uso, SH sin uso, suspendidas o sin uso con riesgo A`],
        ]} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Callout tipo="clave" titulo="En espera de uso: no es alerta">
            Una Pospago sin consumo activada hace menos de {d} días al corte todavía no tuvo tiempo de usarse. El sistema la marca <b>◷ En espera</b> en todas las tablas y la deja fuera de los porcentajes, del nivel y del puntaje del vendedor y del “día con más líneas sin uso”. En el caso testigo fueron <b>{fmt(CT.en_espera)} líneas</b> ({CT.en_espera_dia_corte} del mismo día del corte). Se evalúan en el corte siguiente.
          </Callout>
          <Callout tipo="caso" titulo={`Caso testigo · corte al ${CT.corte}`}>
            {fmt(CT.pospago_sin_uso)} de {fmt(CT.pospago - CT.en_espera)} Pospago netas evaluables sin uso (<b>{fmt(CT.pct_sin_uso)}%</b>) y {fmt(CT.en_espera)} en espera. Por zona, el Interior tenía <b>{fmt(CT.zonas.interior.pct)}% sin uso</b> contra {fmt(CT.zonas.capital.pct)}% de Capital y Central.
          </Callout>
        </div>
        <div className="space-y-4">
          <Verificar items={[
            <>Las marcadas <b>◷ En espera</b> no se verifican todavía: se revisan en el corte siguiente.</>,
            "Nativas contra portadas: muchas nativas sin uso es una señal propia.",
            "Plan acorde al perfil del cliente: planes altos sin uso merecen llamada.",
            "Lotes: activaciones del mismo día y del mismo vendedor.",
            "Estado de la línea al cierre: si ya está suspendida.",
          ]} />
          <Recomendacion texto="Revisar las líneas sin uso con el cliente (tenencia, activación, consumo) y el proceso de venta del vendedor; retener la comisión de las líneas sin uso hasta confirmar consumo." />
        </div>
      </div>
    </Seccion>
  );
}

function Umbral({ titulo, filas }: { titulo: string; filas: [Severidad, string][] }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-ink mb-2">{titulo}</div>
      <ul className="space-y-1.5 text-[13px] text-brand-graphite">
        {filas.map(([s, t]) => <Linea key={t} s={s}>{t}</Linea>)}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ 6. Riesgo de la carga
export function RiesgoCarga({ r, num }: P) {
  return (
    <Seccion id="riesgo-carga" num={num} titulo="Riesgo de la carga × uso"
      lead={<>Claro le asigna un riesgo a cada carga (<code className="text-[13px] bg-brand-bg px-1 rounded">RIESGO_ORI</code>: A alto, M medio, B bajo). Cruzarlo con el uso de la línea dice si la alerta se cumplió y si la validación previa está funcionando.</>}>
      <RiesgoCargaUso />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4 text-[13px] text-brand-graphite leading-relaxed space-y-2">
          <p>Si las cargas <b>A</b> tienen más sin uso que las <b>M</b>, el sistema lo marca como dato llamativo de gravedad media y arma un hallazgo con esas cargas.</p>
          <p>Por vendedor: con <b>{r.nivel_atencion.sin_uso_riesgo_A} o más</b> sin uso con riesgo A queda en alerta media, y cada una suma <b>{r.pesos.sin_uso_riesgo_A} puntos</b>.</p>
          <p className="text-brand-slate">En el caso testigo las A tenían {fmt(CT.riesgo[0].pct)}% sin uso contra {fmt(CT.riesgo[1].pct)}% de las M: la alerta de Claro anticipaba el no uso. Las cargas en espera de uso no entran en este cruce.</p>
        </div>
        <Recomendacion texto="Reforzar la validación de las ventas con riesgo alto antes de finalizarlas (verificación de identidad y domicilio, confirmación telefónica)." />
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ 7. Patrones
type Patron = { icono: ReactNode; titulo: string; sev: Severidad; sevTexto?: string; regla: string; indica: string; verificar: string; visual?: { tipo: "rafaga" | "concentracion" | "umbral" | "reloj" | "portacion"; pct?: number } };

export function Patrones({ r, num }: P) {
  const d = r.dias_sin_uso_antigua, m = r.min_lineas_alerta, pt = r.patrones, sa = r.senal_alta_desde;
  const lista: Patron[] = [
    { icono: <Gauge size={18} />, titulo: `Más de ${fmt(r.umbral_sin_uso_critico)}% sin uso`, sev: "alta", sevTexto: "Crítico", regla: `Más de ${fmt(r.umbral_sin_uso_critico)}% de sus líneas con ${d}+ días sin uso, con ${m} o más evaluables.`, indica: "Ventas que no se usan de forma sistemática: el riesgo es del vendedor, no de un caso aislado.", verificar: "Muestra de llamadas a titulares y revisión del proceso de venta con el supervisor.", visual: { tipo: "umbral", pct: r.umbral_sin_uso_critico } },
    { icono: <Clock size={18} />, titulo: `Sin uso con ${d}+ días`, sev: "alta", sevTexto: `Alta desde ${sa.sin_uso_antiguas}`, regla: `Líneas sin consumo con ${d} días o más desde la activación.`, indica: "Riesgo PFI concreto: la ventana para actuar se está cerrando.", verificar: "Contacto con el titular: tenencia del chip, activación y uso.", visual: { tipo: "reloj" } },
    { icono: <Info size={18} />, titulo: "En espera de uso", sev: "info", sevTexto: "No es alerta", regla: `Pospago sin consumo activadas hace menos de ${d} días al corte.`, indica: "Nada todavía: las líneas no tuvieron tiempo de usarse. No suman puntos ni cambian el nivel.", verificar: "Nada por ahora; volver a mirarlas en el corte siguiente.", visual: { tipo: "reloj" } },
    { icono: <Repeat2 size={18} />, titulo: "Sali Hablando sin uso", sev: "alta", sevTexto: `Alta desde ${sa.sali_sin_uso}`, regla: "Portaciones Sali Hablando del vendedor que no registran consumo.", indica: "Portaciones que no se usan: el riesgo más alto del período.", verificar: "Titular, número portado y solicitud de portación en el legajo.", visual: { tipo: "portacion" } },
    { icono: <Zap size={18} />, titulo: "Entrega en ráfaga", sev: "media", regla: `${pt.pospago_mismo_dia.pct}% o más de sus Pospago activadas el mismo día (con ${pt.pospago_mismo_dia.min} o más).`, indica: "Ventas acumuladas y entregadas juntas: carga en lote, cierre de meta o una base de contactos puntual.", verificar: "Fecha de venta contra fecha de activación en CARGAS; grabaciones y documentación de ese día.", visual: { tipo: "rafaga" } },
    { icono: <CalendarDays size={18} />, titulo: "Sin uso del mismo día", sev: "media", regla: `${pt.sin_uso_mismo_dia.pct}% o más de sus sin uso activadas el mismo día (con ${pt.sin_uso_mismo_dia.min} o más).`, indica: "Un lote puntual con problemas.", verificar: "Qué pasó ese día: clientes, zona, plan y quién cargó.", visual: { tipo: "rafaga" } },
    { icono: <Layers size={18} />, titulo: "Mismo plan", sev: "media", regla: `${pt.sin_uso_mismo_plan.pct}% o más de sus sin uso en el mismo plan (con ${pt.sin_uso_mismo_plan.min} o más).`, indica: "Un plan usado como gancho o mal ofrecido.", verificar: "Si el plan corresponde al perfil del cliente y a la promoción vigente.", visual: { tipo: "concentracion", pct: pt.sin_uso_mismo_plan.pct } },
    { icono: <UserX size={18} />, titulo: "Nativas sin uso", sev: "media", regla: `${pt.nativas_sin_uso.pct}% o más de sus líneas nativas sin uso (con ${pt.nativas_sin_uso.min} nativas o más).`, indica: "Altas nuevas sin un cliente real detrás.", verificar: "Identidad y domicilio del titular; contacto telefónico.", visual: { tipo: "concentracion", pct: pt.nativas_sin_uso.pct } },
    { icono: <Route size={18} />, titulo: "Mismo origen", sev: "info", regla: `${pt.sin_uso_mismo_origen.pct}% o más de sus sin uso de la misma operadora de origen, o casi todas nativas (con ${pt.sin_uso_mismo_origen.min} o más).`, indica: "Una campaña o una base de contactos puntual.", verificar: "Origen de los contactos y campaña con la que se vendió.", visual: { tipo: "concentracion", pct: pt.sin_uso_mismo_origen.pct } },
    { icono: <MapPin size={18} />, titulo: "Misma ciudad", sev: "info", regla: `${pt.sin_uso_misma_ciudad.pct}% o más de sus sin uso en la misma ciudad (con ${pt.sin_uso_misma_ciudad.min} o más).`, indica: "Una zona o un punto de entrega del chip puntual.", verificar: "Domicilios y entrega del chip en esa zona.", visual: { tipo: "concentracion", pct: pt.sin_uso_misma_ciudad.pct } },
    { icono: <Ban size={18} />, titulo: "Suspendidas al cierre", sev: "alta", sevTexto: `Alta desde ${sa.suspendidas}`, regla: "Líneas netas del vendedor suspendidas a la fecha del corte.", indica: "Ventas que ya se cayeron y pueden descontarse.", verificar: "Motivo de la suspensión, con Claro." },
    { icono: <ShieldAlert size={18} />, titulo: "Sin uso con riesgo A", sev: "media", regla: "Cargas con riesgo alto (A) que se finalizaron y no registran uso.", indica: "La alerta de Claro se cumplió.", verificar: "Validación de identidad y domicilio antes de finalizar." },
    { icono: <GitBranch size={18} />, titulo: "Portaciones fuera de DDI", sev: "info", regla: "Portaciones del vendedor que no llegaron a DDI, sin contar Sali Hablando.", indica: "Portaciones fuera del circuito normal.", verificar: "Conciliar con Claro." },
  ];
  return (
    <Seccion id="patrones" num={num} titulo="Patrones de venta y de entrega"
      lead="Cómo vende y cómo entrega cada vendedor. El sistema busca concentraciones y las muestra como señales en su ficha (Riesgos → ranking o vendedores riesgosos). Una señal sola no alcanza: lo que pesa es la combinación.">
      <Callout tipo="clave" titulo="Combinaciones que encienden la alarma">
        <b>Entrega en ráfaga + sin uso del mismo día + mismo plan</b> suele ser un lote cargado junto. <b>Sali Hablando sin uso + mismo origen</b> apunta a una base de contactos. <b>Nativas sin uso + misma ciudad</b> pide revisar domicilios y la entrega del chip.
      </Callout>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 gap-3">
        {lista.map((x) => <TarjetaPatron key={x.titulo} x={x} />)}
      </div>
      <Callout tipo="caso" titulo={`Caso testigo · corte al ${CT.corte}`}>
        Las señales de riesgo más frecuentes fueron: sin uso activadas el mismo día ({CT.senales.mismo_dia} vendedores), casi todas del mismo origen ({CT.senales.origen}), mismo plan ({CT.senales.plan}), concentradas en una ciudad ({CT.senales.ciudad}) y entrega en ráfaga ({CT.senales.rafaga}). Además, {CT.senales.en_espera} vendedores tenían líneas en espera de uso, que no cuentan. En Sali Hablando, 68 de las 113 se activaron el mismo sábado.
      </Callout>
    </Seccion>
  );
}

function TarjetaPatron({ x }: { x: Patron }) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-lg bg-brand-ink text-white grid place-items-center shrink-0">{x.icono}</span>
          <div>
            <div className="font-display text-lg uppercase text-brand-ink leading-none">{x.titulo}</div>
            <div className="mt-1"><SevChip s={x.sev}>{x.sevTexto ?? undefined}</SevChip></div>
          </div>
        </div>
        {x.visual && <MiniVisual tipo={x.visual.tipo} pct={x.visual.pct} />}
      </div>
      <div className="rounded-md bg-brand-bg px-2.5 py-1.5 text-[12px] text-brand-ink"><b>Regla:</b> {x.regla}</div>
      <p className="text-[13px] text-brand-graphite leading-snug"><b>Puede indicar:</b> {x.indica}</p>
      <p className="text-[13px] text-brand-graphite leading-snug"><b>Verificar:</b> {x.verificar}</p>
    </div>
  );
}

// ------------------------------------------------------------------ 8. Semáforo
export function Semaforo({ r, num }: P) {
  return (
    <Seccion id="semaforo" num={num} titulo="Semáforo del vendedor"
      lead={`Crítico es solo el vendedor con más de ${fmt(r.umbral_sin_uso_critico)}% de sus líneas sin uso (con ${r.dias_sin_uso_antigua}+ días de activadas). Los demás riesgos son alertas medias. Dentro de cada nivel, el puntaje ordena a quién mirar primero.`}>
      <SemaforoVendedor r={r} />
      <Sub>Puntaje de riesgo</Sub>
      <Puntaje r={r} />
      <div className="grid md:grid-cols-2 gap-3">
        <Callout tipo="ojo" titulo="Cómo leer el puntaje">
          El puntaje no es una nota del vendedor: es el <b>orden de revisión</b>. Un vendedor con muchas ventas puede sumar más puntos con el mismo porcentaje de sin uso; por eso se mira junto con el nivel y su patrón.
        </Callout>
        <Callout tipo="caso" titulo={`Caso testigo · corte al ${CT.corte}`}>
          De {CT.vendedores.total} vendedores con actividad: <b>{CT.vendedores.criticos} críticos</b>, {CT.vendedores.atencion} en alerta media y {CT.vendedores.total - CT.vendedores.criticos - CT.vendedores.atencion} normales. El sistema crea un hallazgo por cada vendedor riesgoso (hasta {r.max_hallazgos_vendedor}).
        </Callout>
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ 9. Alertas de negocio
export function Alertas({ r, num }: P) {
  const L = r.llamativos, d = r.dias_sin_uso_antigua;
  const filas: { alerta: string; regla: string; sev: Severidad[]; impacto: string; accion: string; hallazgo: string }[] = [
    { alerta: "Sali Hablando sin uso", regla: `Hay SH sin consumo. Alta desde ${L.sali_pct_sin_uso_alta}% de las SH sin uso; si no, media.`, sev: ["alta", "media"], impacto: "Primeras facturas impagas: líneas suspendidas y comisión descontada.", accion: "Verificar titulares, retener la comisión de las SH sin uso y revisar a los vendedores con más casos.", hallazgo: "Sí" },
    { alerta: "Pospago netas sin uso", regla: `Sobre las líneas con ${d}+ días (las en espera no cuentan). Más de ${fmt(r.umbral_sin_uso_critico)}%: alta · más de ${fmt(r.umbral_sin_uso_atencion)}%: media · si no, informativa.`, sev: ["alta", "media", "info"], impacto: "Comisión en riesgo por PFI en cada línea sin uso.", accion: `Contactar a los titulares de las líneas sin uso; las en espera se revisan en el corte siguiente.`, hallazgo: "Por vendedor" },
    { alerta: "Vendedores con riesgo", regla: `Alta si hay algún crítico (más de ${fmt(r.umbral_sin_uso_critico)}% sin uso); media si solo hay alertas medias.`, sev: ["alta", "media"], impacto: "La pérdida se concentra en pocos vendedores.", accion: "Abrir la ficha de cada crítico y trabajar su hallazgo.", hallazgo: `Uno por vendedor (hasta ${r.max_hallazgos_vendedor})` },
    { alerta: "Riesgo de la carga y uso", regla: "Media si las cargas A tienen más sin uso que las M; si no, informativa.", sev: ["media", "info"], impacto: "La validación previa no frena las ventas riesgosas.", accion: "Reforzar la validación de las cargas A antes de finalizarlas.", hallazgo: "Sí, con las A sin uso" },
    { alerta: "Finalizadas sin activar", regla: "Cargas finalizadas que no figuran en DDI ni en PORTABILIDAD del período.", sev: ["media"], impacto: "Ventas que no cobran comisión o que activan tarde.", accion: "Conciliar con Claro y con el corte siguiente; no liquidar hasta confirmar.", hallazgo: "Sí" },
    { alerta: `Pendientes de más de ${L.pendientes_dias} días`, regla: `Media desde ${L.pendientes_viejas_media} cargas; si no, baja.`, sev: ["media", "baja"], impacto: "Ventas que se pierden por no completarse.", accion: "Depurar: rechazar las que no siguen y reclamar a Claro las que dependen de la operadora.", hallazgo: "Sí" },
    { alerta: "Suspendidas al cierre", regla: "Líneas netas suspendidas a la fecha del corte.", sev: ["baja"], impacto: "Ventas que pueden descontarse.", accion: "Verificar el motivo de la suspensión.", hallazgo: "Sí" },
    { alerta: "Concentración de sin uso", regla: `Los ${L.concentracion_top} vendedores con más sin uso: media si concentran ${L.concentracion_pct_media}% o más.`, sev: ["media", "info"], impacto: "El riesgo se corrige con pocas acciones bien dirigidas.", accion: "Priorizar a esos vendedores en la verificación.", hallazgo: "No" },
    { alerta: "Día con más sin uso", regla: `Se informa desde ${L.dia_sin_uso_min} líneas sin uso activadas el mismo día. Los días en espera de uso (menos de ${d} días al corte) nunca se informan.`, sev: ["info"], impacto: "Posible lote o problema puntual.", accion: "Revisar las ventas de ese día: vendedores, plan y zona.", hallazgo: "No" },
    { alerta: "Uso por zona", regla: "Compara el % sin uso del Interior con el de Capital y Central.", sev: ["info"], impacto: "Diferencias regionales en la calidad de la venta.", accion: "Comparar vendedores por zona y reforzar donde hay más sin uso.", hallazgo: "No" },
  ];
  return (
    <Seccion id="alertas" num={num} titulo="Alertas de negocio"
      lead="Lo que el sistema levanta como dato llamativo al analizar un período, con su regla, su severidad, qué le cuesta al negocio y qué se espera del auditor. Algunas generan además un hallazgo automático al crear el informe.">
      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] min-w-[860px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider2 text-white bg-brand-ink">
              <th className="px-3 py-2.5">Alerta</th><th className="px-3 py-2.5">Regla del sistema</th><th className="px-3 py-2.5">Severidad</th>
              <th className="px-3 py-2.5">Impacto en el negocio</th><th className="px-3 py-2.5">Acción del auditor</th><th className="px-3 py-2.5">Hallazgo automático</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.alerta} className="border-b border-brand-border align-top even:bg-brand-bg/50">
                <td className="px-3 py-2.5 font-semibold text-brand-ink">{f.alerta}</td>
                <td className="px-3 py-2.5 text-brand-graphite">{f.regla}</td>
                <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{f.sev.map((s) => <SevChip key={s} s={s} />)}</div></td>
                <td className="px-3 py-2.5 text-brand-graphite">{f.impacto}</td>
                <td className="px-3 py-2.5 text-brand-graphite">{f.accion}</td>
                <td className="px-3 py-2.5 text-brand-slate">{f.hallazgo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ 10. Checklist
export function Checklist({ num }: { num: string }) {
  const fases: { titulo: string; items: ReactNode[] }[] = [
    { titulo: "1 · Preparar", items: [
      "Elegir el corte publicado del mes; si todavía no hay, el último corte.",
      "Revisar que las fuentes no tengan advertencias de versión.",
      "Definir el alcance: período, vendedores o riesgos en foco.",
    ] },
    { titulo: "2 · Analizar (Riesgos)", items: [
      "Leer los datos llamativos de mayor a menor gravedad.",
      "Sali Hablando: por día de portación, por vendedor y línea por línea.",
      "Revisar las líneas sin uso; las marcadas En espera quedan para el corte siguiente.",
      "Abrir la ficha de cada vendedor crítico: patrón y evidencia.",
      "Cruzar riesgo de la carga con uso; comparar Interior con Capital y Central.",
    ] },
    { titulo: "3 · Verificar (fuera del sistema)", items: [
      "Muestra de llamadas a titulares: tenencia, uso y conformidad.",
      "Documentación del legajo y grabación de la venta.",
      "Conciliación con Claro: portaciones, activaciones y suspensiones.",
      "Conversación con el supervisor del vendedor.",
    ] },
    { titulo: "4 · Documentar y cerrar", items: [
      "Un hallazgo por problema: evidencia, severidad, responsable y fecha.",
      "Descartar con nota los automáticos que no se confirman.",
      "Elegir los gráficos que sostienen la conclusión.",
      "Redactar conclusiones y recomendaciones; enviar a revisión.",
      "Cerrar, emitir el PDF y seguir los hallazgos hasta archivar.",
    ] },
  ];
  return (
    <Seccion id="checklist" num={num} titulo="Checklist del auditor"
      lead="El recorrido de un informe de punta a punta. Imprimí la guía y tildá a mano, o usala como control antes de enviar a revisión.">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {fases.map((f) => <Verificar key={f.titulo} titulo={f.titulo} items={f.items} />)}
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ 11. Recomendaciones tipo
export function Recomendaciones({ num }: { num: string }) {
  const recs: [string, string][] = [
    ["Sali Hablando sin uso", "Contactar a los clientes para confirmar la tenencia y el uso de la línea; verificar con Claro el estado de la portación; revisar el proceso de venta de los vendedores con más casos antes de liquidar comisiones."],
    ["Vendedor con líneas sin uso", "Revisar las líneas sin uso con el cliente (tenencia, activación, consumo) y el proceso de venta del vendedor; retener la comisión de las líneas sin uso hasta confirmar consumo."],
    ["Sin uso con riesgo A", "Reforzar la validación de las ventas con riesgo alto antes de finalizarlas (verificación de identidad y domicilio, confirmación telefónica)."],
    ["Finalizadas sin activar", "Conciliar la lista con Claro y con el corte siguiente; no liquidar comisión hasta confirmar la activación."],
    ["Pendientes viejas", "Depurar las cargas a confirmar: rechazar las que no van a completarse y reclamar a Claro las que dependen de la operadora."],
    ["Suspendidas al cierre", "Verificar el motivo de la suspensión y si corresponde descontar la venta."],
    ["Entrega en ráfaga", "Revisar las ventas del día con más activaciones del vendedor: fecha de venta contra fecha de activación, grabaciones y documentación; confirmar con el supervisor si hubo carga acumulada."],
    ["Concentración en una ciudad", "Verificar domicilios y la entrega del chip en la zona concentrada; contrastar con la base de clientes y con el punto de entrega."],
  ];
  return (
    <Seccion id="recomendaciones" num={num} titulo="Recomendaciones tipo"
      lead="Textos listos para pegar en un hallazgo. Las seis primeras son las que el sistema propone en los hallazgos automáticos; ajustalas a lo que verificaste.">
      <div className="grid md:grid-cols-2 print:grid-cols-2 gap-3">
        {recs.map(([t, x]) => <Recomendacion key={t} titulo={t} texto={x} />)}
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ 12. Circuito
export function Circuito({ num }: { num: string }) {
  return (
    <Seccion id="circuito" num={num} titulo="Circuito del informe"
      lead="Cada informe de auditoría pasa por cuatro estados. Todo cambio queda en el historial del informe y en el registro general de la plataforma.">
      <CircuitoInforme />
      <Callout tipo="clave" titulo="Datos congelados">
        Al crear el informe se guarda una copia de todo lo analizado: indicadores, ranking, señales y evidencia. Aunque después se reprocese o se elimine el corte de Ventas Netas, el informe conserva lo que viste y con qué reglas se evaluó.
      </Callout>
    </Seccion>
  );
}

// ------------------------------------------------------------------ 13. Glosario
export function Glosario({ r, num }: P) {
  const t: [string, string][] = [
    ["Corte", "Archivo diario de Claro (hojas DDI, CARGAS y PORTABILIDAD) con los datos a una fecha."],
    ["Publicado", "El corte que vale para el mes. Puede haber varios borradores, pero uno solo publicado."],
    ["Venta neta", "Venta del mes que figura activada: base de la comisión."],
    ["DDI", "Hoja de altas del período."],
    ["CARGAS", "Hoja de ventas cargadas por los vendedores, con su estado y su riesgo."],
    ["PORTABILIDAD", "Hoja de portaciones del período, con tipo, origen y fecha de portación."],
    ["Sali Hablando (SH)", "Portación con modalidad SI-SaliHbl: la línea sale activa antes de completar la portación."],
    ["Nativa", "Línea nueva, que no viene de otra operadora."],
    ["Sin uso", `Línea sin consumo de datos (CONSUMO_DATOS = NO) con ${r.dias_sin_uso_antigua} días o más de activada: alerta PFI.`],
    ["En espera de uso", `Pospago sin consumo activada hace menos de ${r.dias_sin_uso_antigua} días al corte. No es alerta: se evalúa en el corte siguiente.`],
    ["PFI", "Primera factura impaga: suspensión de la línea que descuenta la comisión de la venta."],
    ["Riesgo de la carga", "RIESGO_ORI que asigna Claro al cargar: A alto, M medio, B bajo."],
    ["Entrega en ráfaga", "Muchas activaciones del mismo vendedor en un solo día."],
    ["Puntaje de riesgo", "Suma ponderada de las señales de un vendedor: ordena la revisión."],
    ["Hallazgo", "Problema documentado en el informe, con evidencia, severidad, responsable y fecha."],
    ["Snapshot", "Copia congelada de los datos analizados que guarda cada informe de auditoría."],
  ];
  return (
    <Seccion id="glosario" num={num} titulo="Glosario">
      <dl className="grid sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 gap-x-6 gap-y-3">
        {t.map(([k, v]) => (
          <div key={k} className="border-l-2 border-brand-primary pl-3">
            <dt className="font-display text-lg uppercase text-brand-ink leading-none">{k}</dt>
            <dd className="text-[13px] text-brand-graphite leading-snug mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>
    </Seccion>
  );
}

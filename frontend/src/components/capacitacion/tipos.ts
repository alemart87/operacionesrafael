/** Capacitación y Mentoría: tipos de la API, nombres de los estados y utilidades de formato. */
import type { AudioCoaching } from "@/components/supervision/tipos";
import type { Grabado } from "@/components/portal/grabadora";
import { apiFetch } from "@/lib/api";

export const CAP_API = "/api/v1/capacitacion";
export const CAP_HREF = "/capacitacion";
export const PERM_CAP_VER = "capacitacion.ver";
export const PERM_CAPACITAR = "capacitacion.capacitar";
export const PERM_MENTORIA = "capacitacion.mentoria";
export const PERM_CAP_TOTAL = "capacitacion.total";
/** Perfiles que solo ven este módulo: entran directo a él. */
export const PERFILES_CAPACITACION = ["capacitador", "mentor", "rrhh"];

export type EstadoPostulante = "en_capacitacion" | "aprobo_escrita" | "aprobo_mentoria" | "alta_operativa" | "abandono" | "baja";
export type EstadoGrupo = "en_curso" | "finalizada" | "cancelada";
export type Sexo = "F" | "M" | "X";
export type NivelIpv = "inferior" | "termino_medio" | "superior";

export const ESTADOS: Record<EstadoPostulante, { nombre: string; corto: string; tono: "gris" | "azul" | "naranja" | "verde" | "rojo" | "tinta" }> = {
  en_capacitacion: { nombre: "En capacitación", corto: "En sala", tono: "gris" },
  aprobo_escrita: { nombre: "Aprobó prueba escrita", corto: "Aprobó escrita", tono: "azul" },
  aprobo_mentoria: { nombre: "Aprobó mentoría y OJT", corto: "Aprobó mentoría", tono: "naranja" },
  alta_operativa: { nombre: "Alta operativa", corto: "Alta", tono: "verde" },
  abandono: { nombre: "Abandonó", corto: "Abandonó", tono: "rojo" },
  baja: { nombre: "Dado de baja", corto: "Baja", tono: "rojo" },
};
export const ORDEN_ESTADOS = Object.keys(ESTADOS) as EstadoPostulante[];
export const ESTADOS_GRUPO: Record<EstadoGrupo, { nombre: string; tono: "azul" | "verde" | "gris" }> = {
  en_curso: { nombre: "En curso", tono: "azul" }, finalizada: { nombre: "Finalizada", tono: "verde" }, cancelada: { nombre: "Cancelada", tono: "gris" },
};
export const SEXOS: { v: Sexo; label: string }[] = [{ v: "F", label: "Femenino" }, { v: "M", label: "Masculino" }, { v: "X", label: "Otro" }];
export const NIVEL_IPV: Record<NivelIpv, { nombre: string; color: string }> = {
  superior: { nombre: "Superior", color: "#15803D" }, termino_medio: { nombre: "Término medio", color: "#2A78D6" },
  inferior: { nombre: "Inferior", color: "#E6332A" },
};
/** Motivos frecuentes de abandono o baja (un toque; se puede escribir otro). */
export const MOTIVOS_SALIDA = ["Consiguió otro trabajo", "Horario", "No se presentó", "Distancia / traslado", "No aprobó",
  "Actitud / disciplina", "Motivos personales"];

export interface Persona { id: string; nombre: string; perfil?: string }

export interface Etapa { clave: string; nombre: string; n: number; pct: number | null }
export interface Embudo {
  total: number; estados: Record<EstadoPostulante, number>; activos: number; en_sala: number; en_piso: number;
  aprobaron_escrita: number; aprobaron_mentoria: number; altas: number; salidas: number;
  efectividad: number | null; desercion: number | null; etapas: Etapa[];
}
export interface ResumenIpv {
  realizados: number; en_curso: number; pendientes: number; sin_link: number; total: number; porcentaje: number | null;
  dgv: Record<NivelIpv, number>; promedios: { clave: string; nombre: string; romano: string | null; grupo: string; decatipo: number | null }[];
}
export interface Feedback { feedback: number; oportunidad: number; postulante: number; total: number; promedio?: number | null; sin_feedback?: number }
export interface FilaDemo {
  clave: string; nombre: string; total: number; altas: number; salidas: number; efectividad: number | null; ipv: number;
  dgv_promedio: number | null; edad_promedio: number | null;
}
export interface Estadisticas { sexo: FilaDemo[]; edad: FilaDemo[]; edad_promedio: number | null }

export interface Grupo {
  id: string; nombre: string; operacion: string | null; estado: EstadoGrupo; estado_nombre: string; fecha_inicio: string;
  fin_previsto: string | null; fecha_fin: string | null; duracion_dias: number; motivo: string | null;
  capacitador: Persona; mentores: Persona[]; embudo: Embudo; efectividad: number | null;
  ipv: { realizados: number; total: number; porcentaje: number | null }; feedback: number; roles: string[];
  puede: { estados: EstadoGrupo[]; editar: boolean; postulantes: boolean };
  avance: number | null; meta: { entrenamientos: number; cumplen: number; activos: number };
}
export interface IpvFila {
  estado: "sin_link" | "pendiente" | "en_curso" | "terminado"; respondidas: number; total: number;
  dgv: { decatipo: number; nivel: NivelIpv } | null; terminado_at: string | null; link_activo?: boolean;
}
export interface Postulante {
  id: string; grupo_id: string; nombre: string; apellido: string; ci: string; edad: number; sexo: Sexo; estado: EstadoPostulante;
  estado_nombre: string; estado_at: string | null; motivo: string | null; etapa_max: number; en_piso: boolean; ipv: IpvFila;
  comentarios: Feedback; puede: EstadoPostulante[]; entrenamientos: EntResumen[]; avance: Avance;
}
/** Un entrenamiento enviado a un postulante, con su avance. */
export interface EntResumen {
  id: string; entrenamiento_id: string; nombre: string; intento: number; estado: "pendiente" | "en_curso" | "evaluando" | "terminado"; casos: number;
  hechos: number; pct: number; archivado: boolean; en_chat: boolean; aprobado: boolean | null; nivel: number | null;
  info_pct: number | null; asignado_at: string; terminado_at: string | null;
}
/** Avance de los entrenamientos (el IPV es independiente) y el mínimo de entrenamientos por postulante (no es un tope). */
export interface Avance {
  pct: number | null; casos: number; hechos: number; entrenamientos: number; terminados: number; aprobados: number;
  meta: number; meta_cumplida: boolean;
}
export interface Evento { tipo: string; de: string | null; a: string | null; at: string; por: string | null; motivo?: string | null; detalle?: string | null }
export interface GrupoDetalle extends Grupo {
  postulantes: Postulante[]; ipv_detalle: ResumenIpv; feedback_detalle: Feedback; estadisticas: Estadisticas; historial: Evento[];
}
export interface Resumen {
  grupos: Grupo[];
  totales: { grupos: number; en_curso: number; finalizados: number; cancelados: number; duracion_promedio: number | null;
    embudo: Embudo; ipv: ResumenIpv; feedback: Feedback };
  estadisticas: Estadisticas; puede: { crear: boolean; gestion: boolean };
}
export interface Escala {
  clave: string; nombre: string; romano: string | null; grupo: string; directo: number; maximo: number; decatipo: number; nivel: NivelIpv;
}
export interface ResultadoIpv {
  escalas: Escala[]; fortalezas: string[]; a_trabajar: string[]; senales: string[]; resumen: string; segundos: number | null;
}
export interface Comentario {
  id: string; tipo: "feedback" | "oportunidad" | "postulante"; autor_rol: string; autor: string | null; texto: string; at: string;
  audio: { id: string; estado: string; texto: string | null; duracion_s: number; archivo: boolean } | null;
}
export interface Ficha {
  postulante: Postulante;
  grupo: { id: string; nombre: string; estado: EstadoGrupo; fecha_inicio: string; capacitador: string; dia: number };
  roles: string[]; rol: string;
  puede: { datos: boolean; link: boolean; comentar: boolean };
  ipv: IpvFila & { resultado: ResultadoIpv | null; iniciado_at: string | null; vence_at: string | null; dispositivo: string | null };
  escalas: { clave: string; nombre: string; romano: string | null; grupo: string; descripcion: string }[];
  comentarios: Comentario[]; conteo: Feedback; historial: Evento[];
}
export interface Enlace {
  activo: boolean; vence_at?: string; ipv_estado: string | null; respondidas?: number; total?: number; url: string | null; qr_svg: string | null;
}

// ------------------------------------------------------------------ formato
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Number.isInteger(v) ? v : v.toFixed(1)}%`);
export const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
export const diasTexto = (n: number) => (n === 1 ? "1 día" : `${n} días`);
export const hoyIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });

/** Sube un audio dictado (archivo + duración) a una URL de Capacitación; `publico`: sin sesión (el link del postulante). */
export async function subirDictado(url: string, g: Grabado, publico = false): Promise<AudioCoaching> {
  const ext = g.mime.includes("mp4") ? "m4a" : g.mime.includes("ogg") ? "ogg" : g.mime.includes("wav") ? "wav" : "webm";
  const fd = new FormData();
  fd.append("archivo", new File([g.blob], `dictado.${ext}`, { type: g.mime.split(";")[0] }));
  fd.append("duracion", String(Math.max(0.5, Math.round(g.duracion * 10) / 10)));
  if (!publico) return apiFetch<AudioCoaching>(url, { method: "POST", body: fd });
  const r = await fetch(url, { method: "POST", body: fd });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof b?.detail === "string" ? b.detail : b?.detail?.message ?? "No se pudo subir el audio");
  return b as AudioCoaching;
}

// ------------------------------------------------------------------ entrenamientos con IA
export type Canal = "chat" | "whatsapp" | "llamada";
export interface Actitud {
  rasgos: string[]; paciencia: number; cordialidad: number; desconfianza: number; interes: number; habla: number; tecnologia: number;
}
export interface Caso {
  id: string; orden: number; titulo: string; cliente_nombre: string; cliente_edad: number | null; situacion: string; objetivo: string;
  actitud: Actitud; objeciones: string[]; info_correcta: string[]; primer_mensaje: string | null; detalles: string | null; max_turnos: number;
}
export interface EntrenamientoFila {
  id: string; nombre: string; estado: "borrador" | "activo" | "archivado"; empresa: string; casos: number; creado_por: string;
  updated_at: string; puede_editar: boolean; enviados: number; terminados: number; aprobados: number;
}
export interface Catalogo {
  ia: { disponible: boolean; modelo: string; simulador: boolean }; meta: number;
  rasgos: Record<string, string>; niveles: Record<string, { nombre: string; escala: string[] }>; criterios: Record<string, string>;
}
export interface ResultadoEnt {
  casos: number; info_ok: number; info_pct: number; nivel_promedio: number; perfil_comercial: boolean; informacion_correcta: boolean;
  aprobado: boolean; recomendacion: "incorporar" | "no_incorporar"; umbral_info: number; umbral_nivel: number; resumen: string;
  fuertes: string[]; mejorar: string[]; segundos: number; costo_usd: number; evaluado_at: string;
}
export interface Asignacion extends EntResumen {
  postulante: { id: string; nombre: string; apellido: string; estado: EstadoPostulante }; grupo: { id: string; nombre: string };
  resultado: ResultadoEnt | null;
}
export interface Entrenamiento {
  id: string; nombre: string; instrucciones: string | null; producto: string; empresa: string; canal: Canal; umbral_info: number;
  umbral_nivel: number; estado: "borrador" | "activo" | "archivado"; creado_por: string; casos: Caso[]; puede_editar: boolean;
  asignaciones: Asignacion[];
}
export interface MensajeChat { r: "cliente" | "asesor"; t: string; at: string; lote?: string }
export interface EvaluacionCaso {
  datos: { dato: string; estado: "correcto" | "incorrecto" | "omitido" | "no_aplica"; detalle: string }[]; errores: string[];
  info_correcta: boolean; info_pct: number; nivel: number; criterios: Record<string, number>; fuertes: string[]; mejorar: string[];
  resumen: string; devolucion?: string;
}
/** La devolución corta de un caso que ve el postulante (sin puntajes ni recomendación). */
export interface DevolucionCaso {
  estado: "en_curso" | "evaluando" | "lista" | "sin_devolucion"; info_ok?: boolean; devolucion?: string;
  corregir?: { dato: string; detalle: string }[];
}
export interface Sesion {
  id: string; caso_id: string; titulo: string; cliente: string; estado: string; fin_motivo: string | null; mensajes: MensajeChat[];
  iniciado_at: string; terminado_at: string | null; turnos: number; max_turnos: number;
  evaluacion?: EvaluacionCaso | null; segundos?: number | null; error?: string | null; prueba?: boolean;
  entrenamiento?: string | null; objetivo?: string | null; situacion?: string | null; info_correcta?: string[];
}
export interface EntPostulante extends EntResumen {
  resultado: ResultadoEnt | null;
  casos_detalle: { caso_id: string; orden: number; titulo: string; cliente: string;
    sesion: { id: string; estado: string; segundos: number | null; turnos: number; info_correcta: boolean | null; nivel: number | null;
      resumen: string | null; error: string | null } | null }[];
}

/** «Portabilidad» o «Portabilidad · 2.º intento». */
export const conIntento = (nombre: string, intento?: number) => (intento && intento > 1 ? `${nombre} · ${intento}.º intento` : nombre);

// ------------------------------------------------------------------ en vivo (tablero de los entrenamientos)
export type EstadoVivo = "responde_asesor" | "responde_cliente" | "en_pausa";
export interface SesionVivo {
  id: string; postulante: { id: string; nombre: string; apellido: string }; grupo: { id: string; nombre: string };
  entrenamiento: string | null; intento: number; caso: string | null; cliente: string | null; estado: EstadoVivo; desde: string | null;
  iniciado_at: string; mensajes: number; turnos: number; max_turnos: number | null; ultimo: { r: "cliente" | "asesor"; t: string } | null;
  resp_media: number | null; progreso: { hechos: number; casos: number };
}
export interface PostulanteVivo {
  id: string; nombre: string; apellido: string; grupo: { id: string; nombre: string }; estado: EstadoPostulante;
  vivo: "en_chat" | "en_pausa" | "activo_hoy" | "sin_actividad"; ultima: string | null; casos_hoy: number; nivel_hoy: number | null;
  info_hoy: { ok: number; de: number }; terminados: number; pendientes: number;
}
export interface RecienteVivo {
  id: string; postulante: { id: string; nombre: string; apellido: string }; grupo: { id: string; nombre: string };
  entrenamiento: string | null; intento: number; caso: string | null; cliente: string | null; estado: string; segundos: number | null;
  fin_motivo: string | null; terminado_at: string; nivel: number | null; info_correcta: boolean | null;
}
export interface EnVivo {
  ahora: string; grupos: { id: string; nombre: string }[];
  kpis: { en_chat: number; esperando: number; en_pausa: number; postulantes_hoy: number; postulantes: number; casos_hoy: number;
    entrenamientos_hoy: number; recomendados_hoy: number; nivel_hoy: number | null; info_hoy: number | null; evaluadas_hoy: number;
    tiempo_caso: number | null; resp_media: number | null };
  sesiones: SesionVivo[]; postulantes: PostulanteVivo[]; recientes: RecienteVivo[];
  umbrales: { amarillo: number; rojo: number; pausa_min: number }; minimo: number;
}

export const duracion = (s: number | null | undefined) =>
  s === null || s === undefined ? "—" : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;

export const ESTADO_ENT: Record<"activo" | "borrador" | "archivado", { nombre: string; tono: "verde" | "gris" | "naranja" }> = {
  activo: { nombre: "Activo", tono: "verde" }, borrador: { nombre: "Borrador", tono: "naranja" }, archivado: { nombre: "Archivado", tono: "gris" },
};
/** Los criterios del nivel comercial (los mismos que usa el evaluador). */
export const CRITERIOS: Record<string, string> = {
  escucha: "Escucha y empatía", indagacion: "Indagación", argumentacion: "Argumentación", objeciones: "Manejo de objeciones",
  cierre: "Cierre", claridad: "Trato y claridad",
};

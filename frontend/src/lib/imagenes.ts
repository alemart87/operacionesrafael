/**
 * Imágenes que sube la gente (evidencia de auditoría, figuras del informe diario): tipos admitidos, el selector de
 * archivos rápido y la captura de pantalla. Compartido para que todas las pantallas se comporten igual.
 */
export const MAX_IMAGEN_MB = 15;
/* El selector de archivos filtra por EXTENSIÓN, nunca por tipo MIME: en Windows, Chrome traduce cada tipo MIME a
   extensiones leyendo el registro antes de abrir la ventana y en algunas computadoras eso la demora minutos (y traba el
   equipo). Las demás cargas de la plataforma (.xlsx, .txt) ya filtran así. */
export const EXTENSIONES_IMAGEN = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
export const TIPOS_IMAGEN = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const ACEPTA_PICKER: Record<string, string[]> = { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"], "image/gif": [".gif"] };

export const esImagen = (f: File) =>
  TIPOS_IMAGEN.includes(f.type) || EXTENSIONES_IMAGEN.some((x) => f.name.toLowerCase().endsWith(x));
export const marcaDeTiempo = () => new Date().toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Abre el selector de archivos. Donde existe (Chrome y Edge), usa `showOpenFilePicker` arrancando en el Escritorio y
 * recordando la última carpeta de esa pantalla (`id`): la ventana clásica de Windows abre en la última carpeta que usó
 * el navegador (a veces Imágenes en OneDrive o una carpeta de red con miles de fotos) y tarda minutos en listarla. Si
 * no existe o falla, el `<input type=file>` de siempre (devuelve null: los archivos llegan por su onChange). Devuelve
 * [] si la persona cancela.
 */
export async function elegirImagenes(respaldo: HTMLInputElement | null, id = "imagenes-plataforma"): Promise<File[] | null> {
  const w = window as any;
  if (typeof w.showOpenFilePicker === "function") {
    try {
      const manejadores: any[] = await w.showOpenFilePicker({
        multiple: true, id, startIn: "desktop",
        types: [{ description: "Imágenes (PNG, JPG, WebP, GIF)", accept: ACEPTA_PICKER }],
      });
      return await Promise.all(manejadores.map((h) => h.getFile()));
    } catch (e: any) {
      if (e?.name === "AbortError") return [];          // canceló
      // Otro error (p. ej. la carpeta de inicio no existe): el selector clásico.
    }
  }
  respaldo?.click();
  return null;
}

/** Captura una pantalla o ventana (p. ej. el CRM) sin pasar por ningún selector de archivos: el navegador pregunta qué
 * compartir, se toma un solo cuadro y se corta la transmisión. Devuelve null si la persona cancela. */
export async function capturarPantalla(): Promise<File | null> {
  const md = navigator.mediaDevices as any;
  if (!md?.getDisplayMedia) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await md.getDisplayMedia({ video: { displaySurface: "window" }, audio: false, selfBrowserSurface: "exclude", preferCurrentTab: false });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 350));       // que el primer cuadro esté dibujado
    const lienzo = document.createElement("canvas");
    lienzo.width = video.videoWidth;
    lienzo.height = video.videoHeight;
    lienzo.getContext("2d")!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/png"));
    return blob ? new File([blob], `Captura de pantalla ${marcaDeTiempo()}.png`, { type: "image/png" }) : null;
  } catch (e: any) {
    if (e?.name === "NotAllowedError" || e?.name === "AbortError") return null;
    throw e;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

/** Si el navegador puede capturar una ventana (escritorio con getDisplayMedia). */
export const puedeCapturarPantalla = () =>
  typeof navigator !== "undefined" && !!(navigator.mediaDevices as any)?.getDisplayMedia && window.matchMedia("(min-width: 768px)").matches;

"""Schemas de Auditoría de Ventas — Televentas Claro."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import CATEGORIAS, HALLAZGO_ESTADOS, SEVERIDADES


class FuenteDisponible(BaseModel):
    """Informe de Ventas Netas que el auditor puede tomar como fuente."""
    model_config = ConfigDict(from_attributes=True)
    id: str
    periodo: str
    fecha_dato: Optional[date] = None
    status: str
    netas: int = 0
    pospago: int = 0
    pospago_sin_uso: int = 0
    pct_sin_uso: float = 0.0
    pendientes: int = 0
    generated_at: datetime
    analysis_version: int = 0
    """Versión del análisis con la que se generó; si es anterior a la vigente, la auditoría lo actualiza al usarlo."""
    actualizada: bool = True


class FuenteSeleccion(BaseModel):
    """Una fuente elegida: el tipo (ventas_netas, productividad, sph, logistica, supervision, informe_diario) y su id
    (el informe, o el mes AAAA-MM en Supervisión e Informe diario)."""
    tipo: str = Field(max_length=20)
    id: str = Field(min_length=1, max_length=40)


class _ConFuentes(BaseModel):
    """`report_ids` son informes de Ventas Netas (como siempre); `fuentes` suma cualquier tipo. Hace falta al menos una."""
    report_ids: List[str] = Field(default_factory=list, max_length=24)
    fuentes: List[FuenteSeleccion] = Field(default_factory=list, max_length=60)

    @model_validator(mode="after")
    def _al_menos_una(self):
        if not self.report_ids and not self.fuentes:
            raise ValueError("Elegí al menos una fuente.")
        return self

    def seleccion(self) -> list[dict[str, str]]:
        return [f.model_dump() for f in self.fuentes]


class RiesgosRequest(_ConFuentes):
    pass


class AuditoriaCreate(_ConFuentes):
    titulo: str = Field(min_length=3, max_length=255)
    alcance: Optional[str] = None


class GraficoElegido(BaseModel):
    key: str = Field(max_length=40)
    titulo: Optional[str] = Field(default=None, max_length=200)
    nota: Optional[str] = Field(default=None, max_length=1000)


class AuditoriaUpdate(BaseModel):
    titulo: Optional[str] = Field(default=None, min_length=3, max_length=255)
    alcance: Optional[str] = None
    resumen: Optional[str] = None
    conclusiones: Optional[str] = None
    recomendaciones: Optional[str] = None
    graficos: Optional[List[GraficoElegido]] = None


class EstadoRequest(BaseModel):
    status: str
    nota: Optional[str] = Field(default=None, max_length=2000)


class HallazgoCreate(BaseModel):
    titulo: str = Field(min_length=3, max_length=255)
    descripcion: Optional[str] = None
    severidad: str = "media"
    categoria: str = "otro"
    vendedor: Optional[str] = Field(default=None, max_length=255)
    recomendacion: Optional[str] = None
    responsable: Optional[str] = Field(default=None, max_length=255)
    fecha_compromiso: Optional[date] = None

    def validar(self) -> None:
        if self.severidad not in SEVERIDADES:
            raise ValueError(f"severidad inválida: {self.severidad}")
        if self.categoria not in CATEGORIAS:
            raise ValueError(f"categoría inválida: {self.categoria}")


class HallazgoUpdate(BaseModel):
    titulo: Optional[str] = Field(default=None, min_length=3, max_length=255)
    descripcion: Optional[str] = None
    severidad: Optional[str] = None
    categoria: Optional[str] = None
    vendedor: Optional[str] = Field(default=None, max_length=255)
    recomendacion: Optional[str] = None
    responsable: Optional[str] = Field(default=None, max_length=255)
    fecha_compromiso: Optional[date] = None
    estado: Optional[str] = None
    nota: Optional[str] = Field(default=None, max_length=2000)

    def validar(self) -> None:
        if self.severidad is not None and self.severidad not in SEVERIDADES:
            raise ValueError(f"severidad inválida: {self.severidad}")
        if self.categoria is not None and self.categoria not in CATEGORIAS:
            raise ValueError(f"categoría inválida: {self.categoria}")
        if self.estado is not None and self.estado not in HALLAZGO_ESTADOS:
            raise ValueError(f"estado inválido: {self.estado}")


class SeguimientoCreate(BaseModel):
    texto: str = Field(min_length=1, max_length=4000)
    hallazgo_id: Optional[str] = None


class HallazgoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    auditoria_id: str
    orden: int
    codigo: str
    titulo: str
    descripcion: Optional[str] = None
    severidad: str
    categoria: str
    vendedor: Optional[str] = None
    estado: str
    recomendacion: Optional[str] = None
    responsable: Optional[str] = None
    fecha_compromiso: Optional[date] = None
    evidencia: dict[str, Any] = Field(default_factory=dict)
    origen: str
    created_by: str
    created_at: datetime
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class EvidenciaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    auditoria_id: str
    orden: int
    tipo: str
    titulo: str
    nota: Optional[str] = None
    hallazgo_id: Optional[str] = None
    spec: Optional[dict[str, Any]] = None
    archivo_nombre: Optional[str] = None
    bytes: int = 0
    ancho: Optional[int] = None
    alto: Optional[int] = None
    origen: str
    conversacion_id: Optional[str] = None
    artefacto_id: Optional[str] = None
    """Pieza del lienzo de la que salió (id del artefacto o «id#n» para una parte de un tablero)."""
    created_by: str
    created_at: datetime
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    disponible: bool = True
    """Para imágenes: el archivo está en el disco (si el almacenamiento se perdió, queda la ficha sin la imagen)."""


class EvidenciaUpdate(BaseModel):
    titulo: Optional[str] = Field(default=None, min_length=1, max_length=255)
    nota: Optional[str] = Field(default=None, max_length=4000)
    hallazgo_id: Optional[str] = Field(default=None, max_length=36)
    """Vacío ("") desvincula el hallazgo."""


class EvidenciasOrden(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=200)


class SeguimientoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    auditoria_id: str
    hallazgo_id: Optional[str] = None
    tipo: str
    texto: str
    created_by: str
    created_at: datetime


class AuditoriaResumen(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    codigo: str
    titulo: str
    status: str
    periodo_desde: Optional[str] = None
    periodo_hasta: Optional[str] = None
    fuentes: list[dict[str, Any]] = Field(default_factory=list)
    created_by: str
    created_at: datetime
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    # Conteos para la lista.
    hallazgos_total: int = 0
    hallazgos_abiertos: int = 0
    hallazgos_alta: int = 0


class AuditoriaLista(BaseModel):
    items: List[AuditoriaResumen]
    total: int
    usuarios: dict[str, str] = Field(default_factory=dict)


class AuditoriaDetalle(AuditoriaResumen):
    alcance: Optional[str] = None
    resumen: Optional[str] = None
    conclusiones: Optional[str] = None
    recomendaciones: Optional[str] = None
    snapshot: dict[str, Any] = Field(default_factory=dict)
    graficos: list[dict[str, Any]] = Field(default_factory=list)
    historial: list[dict[str, Any]] = Field(default_factory=list)
    hallazgos: List[HallazgoRead] = Field(default_factory=list)
    evidencias: List[EvidenciaRead] = Field(default_factory=list)
    seguimientos: List[SeguimientoRead] = Field(default_factory=list)
    usuarios: dict[str, str] = Field(default_factory=dict)
    editable: bool = False
    con_seguimiento: bool = False
    transiciones: List[str] = Field(default_factory=list)
    puede_eliminar: bool = False
    reglas_desactualizadas: bool = False
    """El snapshot se evaluó con reglas distintas de las vigentes: en Borrador / En revisión se puede actualizar."""

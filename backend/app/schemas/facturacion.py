"""Schemas del módulo Facturación — Televentas Claro."""
from __future__ import annotations

from datetime import datetime, date
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class FacturacionUploadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    uploaded_by: str
    period_month: Optional[date] = None
    nro_liquidacion: Optional[str] = None
    filename: Optional[str] = None
    status: str
    retry_count: int = 0
    last_error: Optional[str] = None
    uploaded_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class FacturacionUploadList(BaseModel):
    items: List[FacturacionUploadRead]
    total: int


class FacturacionReportSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    upload_id: str
    period_month: Optional[date] = None
    nro_liquidacion: Optional[str] = None
    periodo: Optional[str] = None
    generated_at: datetime
    total: float = 0
    creditos: float = 0
    debitos: float = 0
    ventas_activaciones: int = 0
    is_published: bool = False
    published_at: Optional[datetime] = None
    title: Optional[str] = None


class FacturacionReportDetail(FacturacionReportSummary):
    data: dict[str, Any] = Field(default_factory=dict)


class FacturacionReportList(BaseModel):
    items: List[FacturacionReportSummary]
    total: int


class PublishRequest(BaseModel):
    is_published: bool
    title: Optional[str] = None


class CompareRequest(BaseModel):
    report_ids: List[str] = Field(min_length=2, max_length=24)


class SimuladorRequest(BaseModel):
    """Simulador de facturación: cualquier variable de negocio puede sobreescribirse."""
    parametros: dict[str, Any] = Field(default_factory=dict)


class GponAnualRequest(BaseModel):
    """Proyección anual GPON: parámetros del mes 1 + activaciones de cada mes (mismas utilidades que pospago)."""
    parametros: dict[str, Any] = Field(default_factory=dict)
    ventas_por_mes: List[float] = Field(min_length=1, max_length=24)
    horizonte: int = 12                   # 12, 18 o 24 meses
    meses_afectados: dict[str, dict[str, Any]] = Field(default_factory=dict)
    bonos_adicionales_por_mes: List[float] = Field(default_factory=list)
    nombres_meses: List[str] = Field(default_factory=list)


class SimuladorAnualRequest(BaseModel):
    """Simulación anual: parámetros del mes 1 (fijan estructura y objetivo) + ventas de cada mes."""
    parametros: dict[str, Any] = Field(default_factory=dict)
    ventas_por_mes: List[float] = Field(min_length=1, max_length=18)
    horizonte: int = 12                   # 12 o 18 meses
    # Meses afectados: {"7": {"porta_pct": 30, "efectividad_pct": 85, ...}} — variaciones propias de ese mes.
    meses_afectados: dict[str, dict[str, Any]] = Field(default_factory=dict)
    bonos_adicionales_por_mes: List[float] = Field(default_factory=list)   # bono adicional a mano (Gs) por mes
    nombres_meses: List[str] = Field(default_factory=list)                 # nombres editables de los meses


class SimulacionCreate(BaseModel):
    """Simulación anual guardada: registro del trabajo (nombre, comentario, marcas, post-its)."""
    nombre: str = Field(min_length=1, max_length=160)
    comentario: Optional[str] = None
    horizonte: int = 12
    parametros: dict[str, Any] = Field(default_factory=dict)
    ventas_por_mes: List[float] = Field(min_length=1, max_length=18)
    meses_afectados: dict[str, dict[str, Any]] = Field(default_factory=dict)
    bonos_adicionales_por_mes: List[float] = Field(default_factory=list)   # bono adicional a mano (Gs) por mes
    nombres_meses: List[str] = Field(default_factory=list)                 # nombres editables de los meses
    marcas: List[dict[str, Any]] = Field(default_factory=list)
    postits: List[dict[str, Any]] = Field(default_factory=list)
    notas: List[dict[str, Any]] = Field(default_factory=list)      # notas y comentarios sobre la simulación
    resumen: dict[str, Any] = Field(default_factory=dict)


class SimulacionUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, max_length=160)
    comentario: Optional[str] = None
    horizonte: Optional[int] = None
    parametros: Optional[dict[str, Any]] = None
    ventas_por_mes: Optional[List[float]] = Field(default=None, max_length=18)
    meses_afectados: Optional[dict[str, dict[str, Any]]] = None
    bonos_adicionales_por_mes: Optional[List[float]] = None
    nombres_meses: Optional[List[str]] = None
    marcas: Optional[List[dict[str, Any]]] = None
    postits: Optional[List[dict[str, Any]]] = None
    notas: Optional[List[dict[str, Any]]] = None
    resumen: Optional[dict[str, Any]] = None


class CompareResponse(BaseModel):
    columnas: list[dict[str, Any]]
    conceptos: list[dict[str, Any]]
    totales: list[float]
    creditos: list[float]
    debitos: list[float]
    ventas: list[int]
    variaciones: list[Optional[float]]
    drivers: list[dict[str, Any]]
    descomposicion: list[dict[str, Any]] = []
    delta_total: float = 0
    hallazgos: list[str] = []

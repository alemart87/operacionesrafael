"""Schemas de Ventas Netas — Televentas Claro."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class UploadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    uploaded_by: str
    filename: Optional[str] = None
    status: str
    retry_count: int = 0
    last_error: Optional[str] = None
    uploaded_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class UploadList(BaseModel):
    items: List[UploadRead]
    total: int


class ReportSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    upload_id: str
    periodo: str
    period_month: date
    fecha_dato: Optional[date] = None
    generated_at: datetime
    generated_by: Optional[str] = None
    status: str
    published_at: Optional[datetime] = None
    published_by: Optional[str] = None
    replaced_at: Optional[datetime] = None
    replaced_by_report_id: Optional[str] = None
    title: Optional[str] = None
    netas: int = 0
    pospago: int = 0
    gpon: int = 0
    iptv: int = 0
    pospago_sin_uso: int = 0
    pct_sin_uso: float = 0.0
    pendientes: int = 0


class ReportDetail(ReportSummary):
    data: dict[str, Any] = Field(default_factory=dict)


class ReportList(BaseModel):
    items: List[ReportSummary]
    total: int
    # Nombres de usuario (id -> nombre) para mostrar quién publicó o generó.
    usuarios: dict[str, str] = Field(default_factory=dict)


class PublishRequest(BaseModel):
    """Publicar un borrador. Si ya hay un publicado del período, hace falta `confirm_replace=True`."""
    confirm_replace: bool = False
    title: Optional[str] = None

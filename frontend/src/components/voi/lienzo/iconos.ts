import {
  AreaChart, BarChart3, BarChartHorizontal, Gauge, LayoutDashboard, LineChart, PieChart, Table2,
} from "lucide-react";

/** Ícono y nombre de cada tipo de pieza del lienzo (chips, tarjetas del chat, figuras del informe). */
export const ICONO_TIPO: Record<string, any> = {
  kpis: Gauge, barras: BarChartHorizontal, columnas: BarChart3, apiladas: BarChart3, lineas: LineChart, area: AreaChart,
  dona: PieChart, tabla: Table2, tablero: LayoutDashboard,
};
export const NOMBRE_TIPO: Record<string, string> = {
  kpis: "Indicadores", barras: "Gráfico de barras", columnas: "Gráfico de columnas", apiladas: "Barras apiladas",
  lineas: "Gráfico de líneas", area: "Gráfico de área", dona: "Gráfico de dona", tabla: "Tabla", tablero: "Tablero",
};
